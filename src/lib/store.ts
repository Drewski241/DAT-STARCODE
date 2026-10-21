import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  Account,
  AccountSource,
  CodingJob,
  PaymentIntent,
  Project,
  StoreSnapshot,
} from "@/lib/types";
import { CREDITS_PER_JOB, DAT_ASSET_ID } from "@/lib/config";
import { creditsForDat } from "@/lib/economy";
import { hashPassword, verifyPassword } from "@/lib/password";

const DATA_DIR =
  process.env.DAT_STARCODER_DATA_DIR ??
  process.env.ANVIL_DATA_DIR ??
  path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

/**
 * On Amplify / multi-instance hosts the local filesystem is ephemeral, so
 * login appears to succeed then bounce back. Persist the JSON store to S3
 * when a bucket is configured (same bucket as workspaces is fine).
 */
const STORE_S3_BUCKET =
  process.env.STORE_S3_BUCKET?.trim() ||
  process.env.WORKSPACE_S3_BUCKET?.trim() ||
  "";
const STORE_S3_KEY =
  process.env.STORE_S3_KEY?.trim() || "store/store.json";

function awsRegion() {
  // Amplify forbids custom env vars starting with AWS_; it injects AWS_REGION itself.
  return (
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    process.env.STARCODER_AWS_REGION ??
    "us-east-1"
  );
}

const s3 = STORE_S3_BUCKET
  ? new S3Client({
      region: awsRegion(),
    })
  : null;

const emptyStore = (): StoreSnapshot => ({
  accounts: [],
  payments: [],
  jobs: [],
  projects: [],
});

let writeChain: Promise<void> = Promise.resolve();

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function isMissingS3Object(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === "NoSuchKey" ||
    e.name === "NotFound" ||
    e.$metadata?.httpStatusCode === 404
  );
}

function isOptimisticLockError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === "PreconditionFailed" ||
    e.name === "ConditionalRequestConflict" ||
    e.name === "412" ||
    e.$metadata?.httpStatusCode === 412
  );
}

type StoreRead = { store: StoreSnapshot; etag?: string };

async function readStoreWithMeta(): Promise<StoreRead> {
  if (s3 && STORE_S3_BUCKET) {
    try {
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: STORE_S3_BUCKET,
          Key: STORE_S3_KEY,
        }),
      );
      const raw = await res.Body?.transformToString();
      if (!raw) return { store: emptyStore(), etag: res.ETag };
      return {
        store: JSON.parse(raw) as StoreSnapshot,
        etag: res.ETag,
      };
    } catch (err) {
      if (isMissingS3Object(err)) return { store: emptyStore() };
      const name = err instanceof Error ? err.name : "";
      const msg = err instanceof Error ? err.message : "";
      if (
        name === "CredentialsProviderError" ||
        /could not load credentials|Missing credentials/i.test(msg)
      ) {
        // fall through to local file
      } else if (process.env.AWS_EXECUTION_ENV || process.env.AWS_REGION) {
        throw err;
      }
    }
  }

  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return { store: JSON.parse(raw) as StoreSnapshot };
  } catch {
    return { store: emptyStore() };
  }
}

async function readStore(): Promise<StoreSnapshot> {
  const { store } = await readStoreWithMeta();
  return store;
}

async function writeStore(store: StoreSnapshot, etag?: string) {
  const body = JSON.stringify(store, null, 2);

  if (s3 && STORE_S3_BUCKET) {
    // Always use conditional writes — plain overwrites cause "Job not found"
    // when claim and complete race with other store mutations.
    await s3.send(
      new PutObjectCommand({
        Bucket: STORE_S3_BUCKET,
        Key: STORE_S3_KEY,
        Body: body,
        ContentType: "application/json",
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      }),
    );
    return;
  }

  await ensureDir();
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, STORE_PATH);
}

function jobRecordKey(jobId: string) {
  return `store/jobs/${jobId}.json`;
}

function jobRecordPath(jobId: string) {
  return path.join(DATA_DIR, "jobs", `${jobId}.json`);
}

/** Per-job sidecar so claim/complete survive main store.json races. */
async function saveJobRecord(job: CodingJob) {
  const normalized = normalizeJob(job);
  const body = JSON.stringify(normalized, null, 2);
  if (s3 && STORE_S3_BUCKET) {
    await s3.send(
      new PutObjectCommand({
        Bucket: STORE_S3_BUCKET,
        Key: jobRecordKey(job.id),
        Body: body,
        ContentType: "application/json",
      }),
    );
    return;
  }
  const full = jobRecordPath(job.id);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, "utf8");
}

async function loadJobRecord(jobId: string): Promise<CodingJob | null> {
  if (s3 && STORE_S3_BUCKET) {
    try {
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: STORE_S3_BUCKET,
          Key: jobRecordKey(jobId),
        }),
      );
      const raw = await res.Body?.transformToString();
      if (!raw) return null;
      return normalizeJob(JSON.parse(raw) as CodingJob);
    } catch (err) {
      if (isMissingS3Object(err)) return null;
      throw err;
    }
  }
  try {
    const raw = await fs.readFile(jobRecordPath(jobId), "utf8");
    return normalizeJob(JSON.parse(raw) as CodingJob);
  } catch {
    return null;
  }
}

function mutate<T>(fn: (store: StoreSnapshot) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const maxAttempts = STORE_S3_BUCKET ? 8 : 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { store, etag } = await readStoreWithMeta();
      try {
        const result = fn(store);
        await writeStore(store, etag);
        return result;
      } catch (err) {
        lastErr = err;
        if (isOptimisticLockError(err)) continue;
        throw err;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("Store write conflict; retry");
  });
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalizeAccount(raw: Account): Account {
  return {
    ...raw,
    username: raw.username ?? null,
    email: raw.email ?? null,
    passwordHash: raw.passwordHash ?? null,
    pokerPlayerId: raw.pokerPlayerId ?? null,
    source: raw.source ?? (raw.username ? "local" : "local"),
  };
}

export async function getOrCreateAccount(accountId?: string | null) {
  return mutate((store) => {
    if (accountId) {
      const existing = store.accounts.find((a) => a.id === accountId);
      if (existing) return normalizeAccount(existing);
    }
    const now = new Date().toISOString();
    const account: Account = {
      id: randomUUID(),
      username: null,
      email: null,
      passwordHash: null,
      pokerPlayerId: null,
      source: "local",
      walletAddress: null,
      credits: 0,
      createdAt: now,
      updatedAt: now,
    };
    store.accounts.push(account);
    return account;
  });
}

export async function findAccountByUsername(username: string) {
  const store = await readStore();
  const needle = username.trim().toLowerCase();
  const found = store.accounts.find(
    (a) => a.username && a.username.toLowerCase() === needle,
  );
  return found ? normalizeAccount(found) : null;
}

export async function registerLocalAccount(input: {
  username: string;
  password: string;
  email?: string | null;
}) {
  const username = input.username.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(username)) {
    throw new Error(
      "Username must start with a letter and be 3–20 characters (letters, numbers, _)",
    );
  }
  if (input.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  return mutate((store) => {
    const taken = store.accounts.some(
      (a) => a.username?.toLowerCase() === username.toLowerCase(),
    );
    if (taken) throw new Error("Username already taken");
    const now = new Date().toISOString();
    const account: Account = {
      id: randomUUID(),
      username,
      email: input.email?.trim() || null,
      passwordHash: hashPassword(input.password),
      pokerPlayerId: null,
      source: "local",
      walletAddress: null,
      credits: 20,
      createdAt: now,
      updatedAt: now,
    };
    store.accounts.push(account);
    return normalizeAccount(account);
  });
}

export async function loginLocalAccount(input: {
  username: string;
  password: string;
}) {
  const account = await findAccountByUsername(input.username);
  if (!account?.passwordHash) {
    throw new Error("Unknown username or password");
  }
  if (!verifyPassword(input.password, account.passwordHash)) {
    throw new Error("Unknown username or password");
  }
  return account;
}

export async function upsertPokerLinkedAccount(input: {
  username: string;
  pokerPlayerId: string;
  email?: string | null;
  sageAddress?: string | null;
}) {
  return mutate((store) => {
    const now = new Date().toISOString();
    const byPoker = store.accounts.find(
      (a) => a.pokerPlayerId === input.pokerPlayerId,
    );
    const byName = store.accounts.find(
      (a) =>
        a.username &&
        a.username.toLowerCase() === input.username.toLowerCase(),
    );
    const existing = byPoker ?? byName;
    if (existing) {
      existing.username = input.username;
      existing.pokerPlayerId = input.pokerPlayerId;
      existing.source = "spirit-poker";
      if (input.email) existing.email = input.email;
      if (input.sageAddress) existing.walletAddress = input.sageAddress;
      existing.updatedAt = now;
      return normalizeAccount(existing);
    }
    const account: Account = {
      id: randomUUID(),
      username: input.username,
      email: input.email ?? null,
      passwordHash: null,
      pokerPlayerId: input.pokerPlayerId,
      source: "spirit-poker" satisfies AccountSource,
      walletAddress: input.sageAddress ?? null,
      credits: 20,
      createdAt: now,
      updatedAt: now,
    };
    store.accounts.push(account);
    return normalizeAccount(account);
  });
}

export async function linkWallet(accountId: string, walletAddress: string) {
  return mutate((store) => {
    const account = store.accounts.find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    account.walletAddress = walletAddress;
    account.updatedAt = new Date().toISOString();
    return account;
  });
}

export async function getAccount(accountId: string) {
  const store = await readStore();
  const found = store.accounts.find((a) => a.id === accountId) ?? null;
  return found ? normalizeAccount(found) : null;
}

export function isRegisteredAccount(account: Account) {
  return Boolean(account.username);
}

export async function createPaymentIntent(input: {
  accountId: string;
  packId: string;
  datAmount: number;
  credits?: number;
}) {
  return mutate((store) => {
    const account = store.accounts.find((a) => a.id === input.accountId);
    if (!account) throw new Error("Account not found");
    const now = new Date().toISOString();
    const id = randomUUID();
    const payment: PaymentIntent = {
      id,
      accountId: input.accountId,
      packId: input.packId,
      datAmount: input.datAmount,
      credits: input.credits ?? creditsForDat(input.datAmount),
      status: "pending",
      memo: `starcoder:${id}:${DAT_ASSET_ID.slice(0, 8)}`,
      txId: null,
      createdAt: now,
      confirmedAt: null,
    };
    store.payments.push(payment);
    return payment;
  });
}

export async function getPayment(paymentId: string) {
  const store = await readStore();
  return store.payments.find((p) => p.id === paymentId) ?? null;
}

/** Coin ids / tx refs already used for confirmed burns (prevents double credit). */
export async function listUsedBurnTxIds(): Promise<Set<string>> {
  const store = await readStore();
  const used = new Set<string>();
  for (const p of store.payments) {
    if (
      (p.status === "confirmed" || p.status === "demo") &&
      p.txId
    ) {
      used.add(p.txId);
      used.add(p.txId.replace(/^0x/, ""));
      used.add(`0x${p.txId.replace(/^0x/, "")}`);
    }
  }
  return used;
}

export async function confirmPayment(input: {
  paymentId: string;
  txId?: string | null;
  demo?: boolean;
}) {
  return mutate((store) => {
    const payment = store.payments.find((p) => p.id === input.paymentId);
    if (!payment) throw new Error("Payment not found");
    if (payment.status === "confirmed" || payment.status === "demo") {
      return { payment, account: store.accounts.find((a) => a.id === payment.accountId)! };
    }
    const account = store.accounts.find((a) => a.id === payment.accountId);
    if (!account) throw new Error("Account not found");

    if (input.txId) {
      const normalized = input.txId.toLowerCase();
      const clash = store.payments.some(
        (p) =>
          p.id !== payment.id &&
          p.txId &&
          p.txId.toLowerCase() === normalized &&
          (p.status === "confirmed" || p.status === "demo"),
      );
      if (clash) throw new Error("This on-chain burn was already credited");
    }

    const now = new Date().toISOString();
    payment.status = input.demo ? "demo" : "confirmed";
    payment.txId = input.txId ?? (input.demo ? `demo-${payment.id}` : null);
    payment.confirmedAt = now;
    account.credits += payment.credits;
    account.updatedAt = now;
    return { payment, account };
  });
}

function normalizeJob(job: CodingJob): CodingJob {
  const projectId = job.projectId ?? null;
  const workspaceId =
    job.workspaceId ??
    (projectId
      ? `${job.accountId}/projects/${projectId}`
      : `${job.accountId}/${job.id}`);
  return {
    ...job,
    projectId,
    parentJobId: job.parentJobId ?? null,
    context: job.context ?? null,
    workspaceId,
    workspaceFileCount:
      typeof job.workspaceFileCount === "number" ? job.workspaceFileCount : 0,
  };
}

function normalizeProject(p: Project): Project {
  return { ...p, title: p.title || "Untitled project" };
}

export async function listProjects(accountId: string) {
  const store = await readStore();
  const projects = store.projects ?? [];
  return projects
    .filter((p) => p.accountId === accountId)
    .map(normalizeProject)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(projectId: string) {
  const store = await readStore();
  const found = (store.projects ?? []).find((p) => p.id === projectId) ?? null;
  return found ? normalizeProject(found) : null;
}

export async function createProject(input: {
  accountId: string;
  title?: string | null;
  accountSeed?: Account | null;
}) {
  return mutate((store) => {
    if (!store.projects) store.projects = [];
    ensureAccount(
      store,
      input.accountSeed ?? {
        id: input.accountId,
        username: null,
        email: null,
        passwordHash: null,
        pokerPlayerId: null,
        source: "local",
        walletAddress: null,
        credits: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    );
    const now = new Date().toISOString();
    const title =
      input.title?.trim() ||
      `Project ${now.slice(0, 10)} ${now.slice(11, 16)}`;
    const project: Project = {
      id: randomUUID(),
      accountId: input.accountId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    store.projects.push(project);
    return normalizeProject(project);
  });
}

export async function touchProject(projectId: string) {
  return mutate((store) => {
    if (!store.projects) store.projects = [];
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) return null;
    project.updatedAt = new Date().toISOString();
    return normalizeProject(project);
  });
}

export async function listJobsForProject(projectId: string) {
  const store = await readStore();
  return store.jobs
    .filter((j) => j.projectId === projectId)
    .map(normalizeJob)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listJobs(accountId: string) {
  const store = await readStore();
  const byId = new Map<string, CodingJob>();
  for (const j of store.jobs) {
    if (j.accountId === accountId) byId.set(j.id, normalizeJob(j));
  }
  // Sidecars win when the main store lost a concurrent update.
  for (const j of store.jobs) {
    if (j.accountId !== accountId) continue;
    const side = await loadJobRecord(j.id);
    if (side && side.accountId === accountId) byId.set(side.id, side);
  }
  return [...byId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function getJob(jobId: string) {
  const side = await loadJobRecord(jobId);
  if (side) return side;
  const store = await readStore();
  const found = store.jobs.find((j) => j.id === jobId) ?? null;
  return found ? normalizeJob(found) : null;
}

/** Re-insert an account wiped by a store.json race (JWT still valid). */
function ensureAccount(store: StoreSnapshot, seed: Account): Account {
  let account = store.accounts.find((a) => a.id === seed.id);
  if (account) return account;
  const now = new Date().toISOString();
  account = {
    ...seed,
    passwordHash: seed.passwordHash ?? null,
    createdAt: seed.createdAt || now,
    updatedAt: now,
  };
  store.accounts.push(account);
  return account;
}

export async function enqueueJob(input: {
  accountId: string;
  prompt: string;
  repoHint?: string | null;
  projectId?: string | null;
  parentJobId?: string | null;
  context?: string | null;
  modelRequested?: string | null;
  modelResolved: string;
  modelReason: string;
  /** When store.json lost the row, rehydrate from the authed session account. */
  accountSeed?: Account | null;
}) {
  const result = await mutate((store) => {
    let account = store.accounts.find((a) => a.id === input.accountId);
    if (!account && input.accountSeed && input.accountSeed.id === input.accountId) {
      account = ensureAccount(store, input.accountSeed);
    }
    if (!account) throw new Error("Account not found");
    if (account.credits < CREDITS_PER_JOB) {
      throw new Error(
        `Need ${CREDITS_PER_JOB} credits; balance is ${account.credits}`,
      );
    }
    const projectId = input.projectId?.trim() || null;
    if (projectId) {
      if (!store.projects) store.projects = [];
      const project = store.projects.find((p) => p.id === projectId);
      if (!project || project.accountId !== input.accountId) {
        throw new Error("Project not found");
      }
      project.updatedAt = new Date().toISOString();
    }
    const now = new Date().toISOString();
    account.credits -= CREDITS_PER_JOB;
    account.updatedAt = now;
    const id = randomUUID();
    const workspaceId = projectId
      ? `${input.accountId}/projects/${projectId}`
      : `${input.accountId}/${id}`;
    const job: CodingJob = {
      id,
      accountId: input.accountId,
      projectId,
      prompt: input.prompt.trim(),
      repoHint: input.repoHint?.trim() || null,
      parentJobId: input.parentJobId?.trim() || null,
      context: input.context?.trim() || null,
      modelRequested: input.modelRequested?.trim() || "auto",
      modelResolved: input.modelResolved,
      modelReason: input.modelReason,
      status: "queued",
      creditsCharged: CREDITS_PER_JOB,
      result: null,
      error: null,
      workerId: null,
      workspaceId,
      workspaceFileCount: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    store.jobs.push(job);
    return { job, account };
  });
  await saveJobRecord(result.job);
  return result;
}

export async function claimNextJob(workerId: string) {
  const job = await mutate((store) => {
    const next = store.jobs.find((j) => j.status === "queued");
    if (!next) return null;
    const now = new Date().toISOString();
    next.status = "claimed";
    next.workerId = workerId;
    next.updatedAt = now;
    return next;
  });
  if (job) await saveJobRecord(job);
  return job;
}

export async function markJobRunning(jobId: string, workerId: string) {
  const side = await loadJobRecord(jobId);
  const job = await mutate((store) => {
    let current = store.jobs.find((j) => j.id === jobId);
    if (!current && side) {
      store.jobs.push({ ...side });
      current = store.jobs.find((j) => j.id === jobId);
    }
    if (!current) throw new Error("Job not found");
    if (current.workerId !== workerId) throw new Error("Worker mismatch");
    current.status = "running";
    current.updatedAt = new Date().toISOString();
    return current;
  });
  await saveJobRecord(job);
  return job;
}

export async function completeJob(input: {
  jobId: string;
  workerId: string;
  result?: string | null;
  error?: string | null;
  workspaceFileCount?: number;
  /** Claimed job snapshot from the worker — used if store.json lost the row. */
  snapshot?: CodingJob | null;
}) {
  const side = await loadJobRecord(input.jobId);
  const job = await mutate((store) => {
    let current = store.jobs.find((j) => j.id === input.jobId);
    if (!current && side) {
      store.jobs.push({ ...side });
      current = store.jobs.find((j) => j.id === input.jobId);
    }
    if (!current && input.snapshot && input.snapshot.id === input.jobId) {
      store.jobs.push(normalizeJob(input.snapshot));
      current = store.jobs.find((j) => j.id === input.jobId);
    }
    if (!current) throw new Error("Job not found");
    if (current.workerId && current.workerId !== input.workerId) {
      throw new Error("Worker mismatch");
    }
    current.workerId = input.workerId;
    const now = new Date().toISOString();
    if (!current.workspaceId) {
      current.workspaceId = `${current.accountId}/${current.id}`;
    }
    if (typeof current.workspaceFileCount !== "number") {
      current.workspaceFileCount = 0;
    }
    if (input.error) {
      current.status = "failed";
      current.error = input.error;
      const account = store.accounts.find((a) => a.id === current!.accountId);
      if (account) {
        account.credits += current.creditsCharged;
        account.updatedAt = now;
      }
    } else {
      current.status = "completed";
      current.result = input.result ?? "";
      current.error = null;
      if (typeof input.workspaceFileCount === "number") {
        current.workspaceFileCount = input.workspaceFileCount;
      }
    }
    current.updatedAt = now;
    current.completedAt = now;
    return current;
  });
  await saveJobRecord(job);
  return job;
}

export async function setJobWorkspaceFileCount(
  jobId: string,
  workspaceFileCount: number,
) {
  const side = await loadJobRecord(jobId);
  const job = await mutate((store) => {
    let current = store.jobs.find((j) => j.id === jobId);
    if (!current && side) {
      store.jobs.push({ ...side });
      current = store.jobs.find((j) => j.id === jobId);
    }
    if (!current) throw new Error("Job not found");
    current.workspaceFileCount = workspaceFileCount;
    if (!current.workspaceId) {
      current.workspaceId = `${current.accountId}/${current.id}`;
    }
    current.updatedAt = new Date().toISOString();
    return current;
  });
  await saveJobRecord(job);
  return job;
}

export async function getPayments(accountId: string) {
  const store = await readStore();
  return store.payments
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
