import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  Account,
  CodingJob,
  PaymentIntent,
  StoreSnapshot,
} from "@/lib/types";
import {
  CREDITS_PER_DAT,
  CREDITS_PER_JOB,
  DAT_ASSET_ID,
} from "@/lib/config";

const DATA_DIR = process.env.ANVIL_DATA_DIR ?? path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const emptyStore = (): StoreSnapshot => ({
  accounts: [],
  payments: [],
  jobs: [],
});

let writeChain: Promise<void> = Promise.resolve();

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readStore(): Promise<StoreSnapshot> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as StoreSnapshot;
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: StoreSnapshot) {
  await ensureDir();
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
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

export async function getOrCreateAccount(accountId?: string | null) {
  return mutate((store) => {
    if (accountId) {
      const existing = store.accounts.find((a) => a.id === accountId);
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const account: Account = {
      id: randomUUID(),
      walletAddress: null,
      credits: 20,
      createdAt: now,
      updatedAt: now,
    };
    store.accounts.push(account);
    return account;
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
  return store.accounts.find((a) => a.id === accountId) ?? null;
}

export async function createPaymentIntent(input: {
  accountId: string;
  packId: string;
  datAmount: number;
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
      credits: input.datAmount * CREDITS_PER_DAT,
      status: "pending",
      memo: `anvil:${id}:${DAT_ASSET_ID.slice(0, 8)}`,
      txId: null,
      createdAt: now,
      confirmedAt: null,
    };
    store.payments.push(payment);
    return payment;
  });
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
    const now = new Date().toISOString();
    payment.status = input.demo ? "demo" : "confirmed";
    payment.txId = input.txId ?? (input.demo ? `demo-${payment.id}` : null);
    payment.confirmedAt = now;
    account.credits += payment.credits;
    account.updatedAt = now;
    return { payment, account };
  });
}

export async function listJobs(accountId: string) {
  const store = await readStore();
  return store.jobs
    .filter((j) => j.accountId === accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJob(jobId: string) {
  const store = await readStore();
  return store.jobs.find((j) => j.id === jobId) ?? null;
}

export async function enqueueJob(input: {
  accountId: string;
  prompt: string;
  repoHint?: string | null;
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
    const job: CodingJob = {
      id: randomUUID(),
      accountId: input.accountId,
      prompt: input.prompt.trim(),
      repoHint: input.repoHint?.trim() || null,
      status: "queued",
      creditsCharged: CREDITS_PER_JOB,
      result: null,
      error: null,
      workerId: null,
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
}) {
  return mutate((store) => {
    const job = store.jobs.find((j) => j.id === input.jobId);
    if (!job) throw new Error("Job not found");
    if (job.workerId !== input.workerId) throw new Error("Worker mismatch");
    const now = new Date().toISOString();
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
    }
    job.updatedAt = now;
    job.completedAt = now;
    return job;
  });
}

export async function getPayments(accountId: string) {
  const store = await readStore();
  return store.payments
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
