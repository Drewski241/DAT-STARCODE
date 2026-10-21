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

const s3 = STORE_S3_BUCKET
  ? new S3Client({
      region:
        process.env.AWS_REGION ??
        process.env.AWS_DEFAULT_REGION ??
        "us-east-1",
    })
  : null;

const emptyStore = (): StoreSnapshot => ({
  accounts: [],
  payments: [],
  jobs: [],
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

async function readStore(): Promise<StoreSnapshot> {
  if (s3 && STORE_S3_BUCKET) {
    try {
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: STORE_S3_BUCKET,
          Key: STORE_S3_KEY,
        }),
      );
      const raw = await res.Body?.transformToString();
      if (!raw) return emptyStore();
      return JSON.parse(raw) as StoreSnapshot;
    } catch (err) {
      if (isMissingS3Object(err)) return emptyStore();
      // Local demos without AWS creds fall back to the file store.
      const name = err instanceof Error ? err.name : "";
      const msg = err instanceof Error ? err.message : "";
      if (
        name === "CredentialsProviderError" ||
        /could not load credentials|Missing credentials/i.test(msg)
      ) {
        // fall through
      } else if (process.env.AWS_EXECUTION_ENV || process.env.AWS_REGION) {
        throw err;
      }
    }
  }

  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as StoreSnapshot;
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: StoreSnapshot) {
  const body = JSON.stringify(store, null, 2);

  if (s3 && STORE_S3_BUCKET) {
    await s3.send(
      new PutObjectCommand({
        Bucket: STORE_S3_BUCKET,
        Key: STORE_S3_KEY,
        Body: body,
        ContentType: "application/json",
      }),
    );
    return;
  }

  await ensureDir();
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, STORE_PATH);
}

function mutate<T>(fn: (store: StoreSnapshot) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const store = await readStore();
    const result = fn(store);
    await writeStore(store);
    return result;
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
  return {
    ...job,
    workspaceId: job.workspaceId ?? `${job.accountId}/${job.id}`,
    workspaceFileCount:
      typeof job.workspaceFileCount === "number" ? job.workspaceFileCount : 0,
  };
}

export async function listJobs(accountId: string) {
  const store = await readStore();
  return store.jobs
    .filter((j) => j.accountId === accountId)
    .map(normalizeJob)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJob(jobId: string) {
  const store = await readStore();
  const found = store.jobs.find((j) => j.id === jobId) ?? null;
  return found ? normalizeJob(found) : null;
}

export async function enqueueJob(input: {
  accountId: string;
  prompt: string;
  repoHint?: string | null;
  modelRequested?: string | null;
  modelResolved: string;
  modelReason: string;
}) {
  return mutate((store) => {
    const account = store.accounts.find((a) => a.id === input.accountId);
    if (!account) throw new Error("Account not found");
    if (account.credits < CREDITS_PER_JOB) {
      throw new Error(
        `Need ${CREDITS_PER_JOB} credits; balance is ${account.credits}`,
      );
    }
    const now = new Date().toISOString();
    account.credits -= CREDITS_PER_JOB;
    account.updatedAt = now;
    const id = randomUUID();
    const job: CodingJob = {
      id,
      accountId: input.accountId,
      prompt: input.prompt.trim(),
      repoHint: input.repoHint?.trim() || null,
      modelRequested: input.modelRequested?.trim() || "auto",
      modelResolved: input.modelResolved,
      modelReason: input.modelReason,
      status: "queued",
      creditsCharged: CREDITS_PER_JOB,
      result: null,
      error: null,
      workerId: null,
      workspaceId: `${input.accountId}/${id}`,
      workspaceFileCount: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    store.jobs.push(job);
    return { job, account };
  });
}

export async function claimNextJob(workerId: string) {
  return mutate((store) => {
    const job = store.jobs.find((j) => j.status === "queued");
    if (!job) return null;
    const now = new Date().toISOString();
    job.status = "claimed";
    job.workerId = workerId;
    job.updatedAt = now;
    return job;
  });
}

export async function markJobRunning(jobId: string, workerId: string) {
  return mutate((store) => {
    const job = store.jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");
    if (job.workerId !== workerId) throw new Error("Worker mismatch");
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    return job;
  });
}

export async function completeJob(input: {
  jobId: string;
  workerId: string;
  result?: string | null;
  error?: string | null;
  workspaceFileCount?: number;
}) {
  return mutate((store) => {
    const job = store.jobs.find((j) => j.id === input.jobId);
    if (!job) throw new Error("Job not found");
    if (job.workerId !== input.workerId) throw new Error("Worker mismatch");
    const now = new Date().toISOString();
    // Backfill for jobs created before workspaces existed.
    if (!job.workspaceId) {
      job.workspaceId = `${job.accountId}/${job.id}`;
    }
    if (typeof job.workspaceFileCount !== "number") {
      job.workspaceFileCount = 0;
    }
    if (input.error) {
      job.status = "failed";
      job.error = input.error;
      const account = store.accounts.find((a) => a.id === job.accountId);
      if (account) {
        account.credits += job.creditsCharged;
        account.updatedAt = now;
      }
    } else {
      job.status = "completed";
      job.result = input.result ?? "";
      job.error = null;
      if (typeof input.workspaceFileCount === "number") {
        job.workspaceFileCount = input.workspaceFileCount;
      }
    }
    job.updatedAt = now;
    job.completedAt = now;
    return job;
  });
}

export async function setJobWorkspaceFileCount(
  jobId: string,
  workspaceFileCount: number,
) {
  return mutate((store) => {
    const job = store.jobs.find((j) => j.id === jobId);
    if (!job) throw new Error("Job not found");
    job.workspaceFileCount = workspaceFileCount;
    if (!job.workspaceId) job.workspaceId = `${job.accountId}/${job.id}`;
    job.updatedAt = new Date().toISOString();
    return job;
  });
}

export async function getPayments(accountId: string) {
  const store = await readStore();
  return store.payments
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
