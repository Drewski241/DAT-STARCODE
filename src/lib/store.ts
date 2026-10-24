import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  Account,
  AccountSource,
  CodingJob,
  JobEvent,
  JobEventType,
  PaymentIntent,
  Project,
  StoreSnapshot,
} from "@/lib/types";
import { DAT_ASSET_ID } from "@/lib/config";
import { creditsForDat } from "@/lib/economy";
import { priceJob } from "@/lib/job-pricing";
import { resolveModel } from "@/lib/models";
import { hashPassword, verifyPassword } from "@/lib/password";
import { awsClientConfig } from "@/lib/aws-creds";
import {
  clearWorkspaceBucketCache,
  formatAwsError,
  peekWorkspaceBucketEnv,
  resolveWorkspaceBucket,
} from "@/lib/s3-bucket";
import { clearLiveEvents, pushLiveEvent } from "@/lib/job-live-bus";

const DATA_DIR =
  process.env.DAT_STARCODER_DATA_DIR ??
  process.env.ANVIL_DATA_DIR ??
  path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

function envName(name: string): string {
  return (process.env[name] ?? "").trim();
}

function getStoreS3Key(): string {
  return envName("STORE_S3_KEY") || "store/store.json";
}

let s3Client: S3Client | null = null;

async function getS3(): Promise<{
  client: S3Client;
  bucket: string;
  source: string;
} | null> {
  const resolved = await resolveWorkspaceBucket();
  if (!resolved.bucket) return null;
  if (!s3Client) {
    s3Client = new S3Client(awsClientConfig());
  }
  return {
    client: s3Client,
    bucket: resolved.bucket,
    source: resolved.source,
  };
}

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

function isAwsHosted() {
  return Boolean(
    envName("AWS_EXECUTION_ENV") ||
      envName("AWS_REGION") ||
      envName("AMPLIFY_APP_ID") ||
      envName("AWS_APP_ID"),
  );
}

async function readStoreWithMeta(): Promise<StoreRead> {
  const s3 = await getS3();
  if (s3) {
    try {
      const res = await s3.client.send(
        new GetObjectCommand({
          Bucket: s3.bucket,
          Key: getStoreS3Key(),
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
      clearWorkspaceBucketCache();
      // Never fall back to ephemeral local disk when S3 is configured —
      // that made Amplify claim() see an empty store while the studio
      // (another instance) still showed queued jobs.
      throw new Error(`store S3 read failed: ${formatAwsError(err)}`);
    }
  }

  // Local demo only — Amplify must resolve a bucket via env, SSM, or convention.
  if (isAwsHosted()) {
    const resolved = await resolveWorkspaceBucket();
    const peek = peekWorkspaceBucketEnv();
    throw new Error(
      `Could not resolve workspace S3 bucket on Amplify (env store=${peek.store}/${peek.storeLen} workspace=${peek.workspace}/${peek.workspaceLen} source=${resolved.source}). ${resolved.error || "Set WORKSPACE_S3_BUCKET or grant Amplify s3+ssm on the workspace bucket."}`,
    );
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
  const s3 = await getS3();

  if (s3) {
    // Always use conditional writes — plain overwrites cause "Job not found"
    // when claim and complete race with other store mutations.
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: getStoreS3Key(),
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
  const s3 = await getS3();
  if (s3) {
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
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
  const s3 = await getS3();
  if (s3) {
    try {
      const res = await s3.client.send(
        new GetObjectCommand({
          Bucket: s3.bucket,
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

/** List recent job sidecar IDs (S3 or local) so claim can recover orphans. */
async function listJobSidecarIds(limit = 80): Promise<string[]> {
  const s3 = await getS3();
  if (s3) {
    const res = await s3.client.send(
      new ListObjectsV2Command({
        Bucket: s3.bucket,
        Prefix: "store/jobs/",
        MaxKeys: Math.min(Math.max(limit * 2, limit), 200),
      }),
    );
    const objs = [...(res.Contents ?? [])].sort((a, b) => {
      const at = a.LastModified?.getTime() ?? 0;
      const bt = b.LastModified?.getTime() ?? 0;
      return bt - at;
    });
    const ids: string[] = [];
    for (const obj of objs) {
      const key = obj.Key ?? "";
      const m = /^store\/jobs\/([^/]+)\.json$/.exec(key);
      if (m) ids.push(m[1]);
      if (ids.length >= limit) break;
    }
    return ids;
  }
  try {
    const dir = path.join(DATA_DIR, "jobs");
    const names = await fs.readdir(dir);
    const stats = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map(async (n) => {
          const full = path.join(dir, n);
          const st = await fs.stat(full);
          return { id: n.replace(/\.json$/, ""), mtime: st.mtimeMs };
        }),
    );
    return stats
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((s) => s.id);
  } catch {
    return [];
  }
}

function mutate<T>(fn: (store: StoreSnapshot) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const resolved = await resolveWorkspaceBucket();
    const maxAttempts = resolved.bucket ? 8 : 1;
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
    githubLogin: raw.githubLogin ?? null,
    githubTokenEnc: raw.githubTokenEnc ?? null,
    githubConnectedAt: raw.githubConnectedAt ?? null,
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
      githubLogin: null,
      githubTokenEnc: null,
      githubConnectedAt: null,
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
      githubLogin: null,
      githubTokenEnc: null,
      githubConnectedAt: null,
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
      githubLogin: null,
      githubTokenEnc: null,
      githubConnectedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    store.accounts.push(account);
    return normalizeAccount(account);
  });
}

export async function setGithubConnection(
  accountId: string,
  input: { login: string; tokenEnc: string },
) {
  return mutate((store) => {
    const account = store.accounts.find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    account.githubLogin = input.login;
    account.githubTokenEnc = input.tokenEnc;
    account.githubConnectedAt = new Date().toISOString();
    account.updatedAt = account.githubConnectedAt;
    return normalizeAccount(account);
  });
}

export async function clearGithubConnection(accountId: string) {
  return mutate((store) => {
    const account = store.accounts.find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    account.githubLogin = null;
    account.githubTokenEnc = null;
    account.githubConnectedAt = null;
    account.updatedAt = new Date().toISOString();
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

export async function unlinkWallet(accountId: string) {
  return mutate((store) => {
    const account = store.accounts.find((a) => a.id === accountId);
    if (!account) throw new Error("Account not found");
    account.walletAddress = null;
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
    events: Array.isArray(job.events) ? job.events : [],
    toolSteps: typeof job.toolSteps === "number" ? job.toolSteps : 0,
    githubUrl: job.githubUrl ?? null,
    githubBranch: job.githubBranch ?? null,
    githubPrUrl: job.githubPrUrl ?? null,
    stepsUsed: typeof job.stepsUsed === "number" ? job.stepsUsed : null,
  };
}

function normalizeProject(p: Project): Project {
  return {
    ...p,
    title: p.title || "Untitled project",
    githubUrl: p.githubUrl ?? null,
    githubRepo: p.githubRepo ?? null,
    githubDefaultBranch: p.githubDefaultBranch ?? null,
    githubOpenPr: p.githubOpenPr !== false,
  };
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
        githubLogin: null,
        githubTokenEnc: null,
        githubConnectedAt: null,
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
      githubUrl: null,
      githubRepo: null,
      githubDefaultBranch: null,
      githubOpenPr: true,
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

export async function updateProjectGithub(
  projectId: string,
  accountId: string,
  input: {
    githubUrl?: string | null;
    githubRepo?: string | null;
    githubDefaultBranch?: string | null;
    githubOpenPr?: boolean;
  },
) {
  return mutate((store) => {
    if (!store.projects) store.projects = [];
    const project = store.projects.find((p) => p.id === projectId);
    if (!project || project.accountId !== accountId) {
      throw new Error("Project not found");
    }
    if (input.githubUrl !== undefined) {
      project.githubUrl = input.githubUrl;
    }
    if (input.githubRepo !== undefined) {
      project.githubRepo = input.githubRepo;
    }
    if (input.githubDefaultBranch !== undefined) {
      project.githubDefaultBranch = input.githubDefaultBranch;
    }
    if (typeof input.githubOpenPr === "boolean") {
      project.githubOpenPr = input.githubOpenPr;
    }
    project.updatedAt = new Date().toISOString();
    return normalizeProject(project);
  });
}

function pickNewerJob(a: CodingJob, b: CodingJob): CodingJob {
  return a.updatedAt >= b.updatedAt ? a : b;
}

async function mergeJobWithSidecar(job: CodingJob): Promise<CodingJob> {
  const side = await loadJobRecord(job.id);
  if (!side) return normalizeJob(job);
  return pickNewerJob(normalizeJob(job), side);
}

export async function listJobsForProject(projectId: string) {
  const store = await readStore();
  const jobs = await Promise.all(
    store.jobs
      .filter((j) => j.projectId === projectId)
      .map((j) => mergeJobWithSidecar(j)),
  );
  return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listJobs(accountId: string) {
  const store = await readStore();
  const byId = new Map<string, CodingJob>();
  for (const j of store.jobs) {
    if (j.accountId === accountId) byId.set(j.id, normalizeJob(j));
  }
  // Merge sidecars (including orphans missing from store.jobs).
  const sidecarIds = await listJobSidecarIds(60);
  const ids = new Set<string>([
    ...[...byId.keys()],
    ...sidecarIds,
  ]);
  await Promise.all(
    [...ids].map(async (id) => {
      const side = await loadJobRecord(id);
      if (!side || side.accountId !== accountId) return;
      const prev = byId.get(side.id);
      byId.set(side.id, prev ? pickNewerJob(prev, side) : side);
    }),
  );
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
    // Price from the resolved Ollama tag (Auto already picked 7B vs general).
    const priced = priceJob({
      prompt: input.prompt,
      modelId: input.modelResolved,
    });
    const charge = priced.total;
    if (account.credits < charge) {
      throw new Error(
        `Need ${charge} credits (${priced.lines.join("; ")}); balance is ${account.credits}`,
      );
    }
    const projectId = input.projectId?.trim() || null;
    let projectGithubUrl: string | null = null;
    if (projectId) {
      if (!store.projects) store.projects = [];
      const project = store.projects.find((p) => p.id === projectId);
      if (!project || project.accountId !== input.accountId) {
        throw new Error("Project not found");
      }
      project.updatedAt = new Date().toISOString();
      projectGithubUrl = project.githubUrl ?? project.githubRepo ?? null;
    }
    const now = new Date().toISOString();
    account.credits -= charge;
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
      githubUrl: projectGithubUrl,
      parentJobId: input.parentJobId?.trim() || null,
      context: input.context?.trim() || null,
      modelRequested: input.modelRequested?.trim() || "auto",
      modelResolved: input.modelResolved,
      modelReason: input.modelReason,
      status: "queued",
      creditsCharged: charge,
      stepsUsed: null,
      result: null,
      error: null,
      workerId: null,
      workspaceId,
      workspaceFileCount: 0,
      githubBranch: null,
      githubPrUrl: null,
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

const STALE_CLAIM_MS = Number(process.env.STALE_JOB_CLAIM_MS || 45_000);

function isClaimable(job: CodingJob, nowMs: number): boolean {
  if (job.status === "queued") return true;
  if (job.status !== "claimed" && job.status !== "running") return false;
  const updated = Date.parse(job.updatedAt || job.createdAt);
  if (!Number.isFinite(updated)) return true;
  return nowMs - updated >= STALE_CLAIM_MS;
}

/**
 * Claim the next job. Prefers `queued`; also reclaims `claimed`/`running`
 * jobs whose updatedAt is older than STALE_JOB_CLAIM_MS (dead worker).
 * Reconciles store.json with per-job sidecars (including orphan sidecars
 * missing from store.jobs) so Amplify races cannot hide queued work.
 */
export async function claimNextJob(workerId: string) {
  const snapshot = await readStore();
  const knownIds = new Set(snapshot.jobs.map((j) => j.id));
  const sidecarIds = await listJobSidecarIds();
  const loadIds = new Set<string>([
    ...snapshot.jobs
      .filter(
        (j) =>
          j.status === "queued" ||
          j.status === "claimed" ||
          j.status === "running",
      )
      .map((j) => j.id),
    ...sidecarIds.filter((id) => !knownIds.has(id)),
  ]);
  // Also reload sidecars for every known active-looking row.
  for (const id of sidecarIds) loadIds.add(id);

  const sides = new Map<string, CodingJob>();
  await Promise.all(
    [...loadIds].slice(0, 100).map(async (id) => {
      const side = await loadJobRecord(id);
      if (side) sides.set(id, side);
    }),
  );

  const job = await mutate((store) => {
    const nowMs = Date.now();
    // Rehydrate / refresh from sidecars.
    for (const side of sides.values()) {
      if (
        side.status !== "queued" &&
        side.status !== "claimed" &&
        side.status !== "running"
      ) {
        continue;
      }
      const idx = store.jobs.findIndex((j) => j.id === side.id);
      if (idx < 0) {
        store.jobs.push({ ...side });
        continue;
      }
      const newer = pickNewerJob(normalizeJob(store.jobs[idx]), side);
      if (
        newer.updatedAt !== store.jobs[idx].updatedAt ||
        newer.status !== store.jobs[idx].status
      ) {
        store.jobs[idx] = { ...newer };
      }
    }
    // Prefer true queued jobs; otherwise reclaim stale claimed/running.
    const next =
      store.jobs.find((j) => j.status === "queued") ??
      store.jobs.find((j) => isClaimable(j, nowMs));
    if (!next) return null;
    const now = new Date().toISOString();
    next.status = "claimed";
    next.workerId = workerId;
    next.updatedAt = now;
    next.error = null;
    // Re-run Auto routing at claim time so queued jobs pick up
    // improved coding-hint heuristics (e.g. "build a … game").
    const requested = (next.modelRequested || "auto").trim() || "auto";
    if (requested === "auto") {
      const routed = resolveModel("auto", next.prompt);
      next.modelResolved = routed.resolved;
      next.modelReason = routed.reason;
    }
    return next;
  });
  if (job) await saveJobRecord(job);
  return job;
}

/** Worker-facing queue snapshot for diagnosing stuck jobs. */
export async function getWorkerQueueSnapshot() {
  const store = await readStore();
  const nowMs = Date.now();
  const sidecarIds = await listJobSidecarIds(40);
  const sides = (
    await Promise.all(sidecarIds.map((id) => loadJobRecord(id)))
  ).filter((j): j is CodingJob => Boolean(j));

  const summarize = (j: CodingJob) => {
    const updated = Date.parse(j.updatedAt || j.createdAt);
    const ageMs = Number.isFinite(updated) ? nowMs - updated : null;
    return {
      id: j.id,
      status: j.status,
      workerId: j.workerId,
      modelResolved: j.modelResolved,
      updatedAt: j.updatedAt,
      ageMs,
      claimable: isClaimable(j, nowMs),
      prompt: j.prompt.slice(0, 80),
    };
  };

  const byStatus: Record<string, number> = {};
  for (const j of store.jobs) {
    byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  }

  const resolved = await resolveWorkspaceBucket();
  return {
    storeJobCount: store.jobs.length,
    byStatus,
    storeBackend: resolved.bucket ? "s3" : "local",
    storeBucketSource: resolved.source,
    storeBucketConfigured: Boolean(resolved.bucket),
    storeBucketPreview: resolved.bucket
      ? `${resolved.bucket.slice(0, 12)}…`
      : "",
    envPeek: peekWorkspaceBucketEnv(),
    staleClaimMs: STALE_CLAIM_MS,
    activeInStore: store.jobs
      .filter(
        (j) =>
          j.status === "queued" ||
          j.status === "claimed" ||
          j.status === "running",
      )
      .map(summarize),
    sidecarActive: sides
      .filter(
        (j) =>
          j.status === "queued" ||
          j.status === "claimed" ||
          j.status === "running",
      )
      .map(summarize),
  };
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

const MAX_JOB_EVENTS = 200;

export async function appendJobEvent(input: {
  jobId: string;
  workerId: string;
  type: JobEventType;
  message: string;
  data?: Record<string, unknown> | null;
}) {
  const side = await loadJobRecord(input.jobId);
  const job = await mutate((store) => {
    let current = store.jobs.find((j) => j.id === input.jobId);
    if (!current && side) {
      store.jobs.push({ ...side });
      current = store.jobs.find((j) => j.id === input.jobId);
    }
    if (!current) throw new Error("Job not found");
    if (current.workerId && current.workerId !== input.workerId) {
      throw new Error("Worker mismatch");
    }
    if (current.status === "completed" || current.status === "failed") {
      throw new Error("Job already finished");
    }
    const now = new Date().toISOString();
    const event: JobEvent = {
      id: randomUUID(),
      t: now,
      type: input.type,
      message: String(input.message || "").slice(0, 2000),
      data: input.data ?? null,
    };
    if (!current.events) current.events = [];
    // Keep durable events for tools/status; tokens stay on the live bus.
    if (input.type !== "token") {
      current.events.push(event);
      if (current.events.length > MAX_JOB_EVENTS) {
        current.events = current.events.slice(-MAX_JOB_EVENTS);
      }
    }
    pushLiveEvent(current.id, event);
    current.updatedAt = now;
    return current;
  });
  await saveJobRecord(job);
  return { job, event: (job.events ?? []).at(-1) ?? null };
}

export async function completeJob(input: {
  jobId: string;
  workerId: string;
  result?: string | null;
  error?: string | null;
  workspaceFileCount?: number;
  toolSteps?: number;
  githubBranch?: string | null;
  githubPrUrl?: string | null;
  stepsUsed?: number | null;
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
    if (typeof input.toolSteps === "number") {
      current.toolSteps = Math.max(0, input.toolSteps);
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
      if (input.githubBranch !== undefined) {
        current.githubBranch = input.githubBranch;
      }
      if (input.githubPrUrl !== undefined) {
        current.githubPrUrl = input.githubPrUrl;
      }
    }
    if (typeof input.stepsUsed === "number") {
      current.stepsUsed = input.stepsUsed;
    }
    current.updatedAt = now;
    current.completedAt = now;
    return current;
  });
  clearLiveEvents(input.jobId);
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

/**
 * Recompute credits from durable ledger rows so Amplify redeploys / store
 * races cannot silently zero a balance when payments are still on S3.
 *
 * expected = signupBonus(20 if registered) + confirmed burns − spent on
 * non-failed jobs (failed jobs already refunded into account.credits).
 */
export async function reconcileAccountCredits(accountId: string) {
  return mutate((store) => {
    const account = store.accounts.find((a) => a.id === accountId);
    if (!account) return null;

    const granted = store.payments
      .filter(
        (p) =>
          p.accountId === accountId &&
          (p.status === "confirmed" || p.status === "demo"),
      )
      .reduce((sum, p) => sum + (p.credits || 0), 0);

    const spent = store.jobs
      .filter(
        (j) =>
          j.accountId === accountId &&
          (j.status === "queued" ||
            j.status === "claimed" ||
            j.status === "running" ||
            j.status === "completed"),
      )
      .reduce((sum, j) => sum + (j.creditsCharged || 0), 0);

    // Local/Spirit signup grants 20 once when the account is registered.
    const signupBonus = account.username ? 20 : 0;
    const expected = Math.max(0, signupBonus + granted - spent);

    if (account.credits !== expected) {
      account.credits = expected;
      account.updatedAt = new Date().toISOString();
    }
    return normalizeAccount(account);
  });
}

/** Operator/customer-safe snapshot: is the credit ledger on S3? */
export async function getStorePersistenceInfo() {
  const resolved = await resolveWorkspaceBucket();
  const peek = peekWorkspaceBucketEnv();
  if (!resolved.bucket) {
    return {
      mode: isAwsHosted() ? ("unconfigured" as const) : ("local" as const),
      ok: !isAwsHosted(),
      source: resolved.source,
      error: resolved.error ?? null,
      envPeek: peek,
      key: getStoreS3Key(),
    };
  }
  try {
    const s3 = await getS3();
    if (!s3) {
      return {
        mode: "unconfigured" as const,
        ok: false,
        source: resolved.source,
        error: "bucket resolved but S3 client unavailable",
        envPeek: peek,
        key: getStoreS3Key(),
      };
    }
    await s3.client.send(
      new GetObjectCommand({
        Bucket: s3.bucket,
        Key: getStoreS3Key(),
      }),
    );
    return {
      mode: "s3" as const,
      ok: true,
      source: resolved.source,
      bucketSuffix: s3.bucket.slice(-12),
      error: null,
      key: getStoreS3Key(),
    };
  } catch (err) {
    if (isMissingS3Object(err)) {
      return {
        mode: "s3" as const,
        ok: true,
        source: resolved.source,
        bucketSuffix: resolved.bucket.slice(-12),
        error: null,
        note: "store object not created yet — first write will create it",
        key: getStoreS3Key(),
      };
    }
    return {
      mode: "s3" as const,
      ok: false,
      source: resolved.source,
      bucketSuffix: resolved.bucket.slice(-12),
      error: formatAwsError(err),
      key: getStoreS3Key(),
    };
  }
}
