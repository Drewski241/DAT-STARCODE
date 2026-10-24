import { randomUUID } from "crypto";
import type {
  Account,
  AccountSource,
  AgentProfile,
  CodingJob,
  JobEvent,
  JobEventType,
  JobKind,
  PaymentIntent,
  Project,
  ProjectStep,
  StoreSnapshot,
} from "@/lib/types";
import { CREDITS_PER_JOB, DAT_ASSET_ID } from "@/lib/config";
import { creditsForDat } from "@/lib/economy";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  getStoreBackendKind,
  loadSnapshot,
  saveSnapshot,
} from "@/lib/store-backend";
import { clearLiveEvents, pushLiveEvent } from "@/lib/job-live-bus";

function normalizeJob(raw: CodingJob): CodingJob {
  return {
    ...raw,
    kind: raw.kind ?? "task",
    projectId: raw.projectId ?? null,
    stepId: raw.stepId ?? null,
    agentProfile: raw.agentProfile ?? "coding",
    toolSteps: raw.toolSteps ?? 0,
    events: Array.isArray(raw.events) ? raw.events : [],
  };
}

function normalizeStore(raw: StoreSnapshot): StoreSnapshot {
  return {
    accounts: raw.accounts ?? [],
    payments: raw.payments ?? [],
    jobs: (raw.jobs ?? []).map((j) => normalizeJob(j)),
    projects: raw.projects ?? [],
  };
}

let writeChain: Promise<void> = Promise.resolve();

async function readStore(): Promise<StoreSnapshot> {
  const { store } = await loadSnapshot();
  return normalizeStore(store);
}

function mutate<T>(fn: (store: StoreSnapshot) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const maxAttempts = getStoreBackendKind() === "dynamodb" ? 5 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const loaded = await loadSnapshot();
      const store = normalizeStore(loaded.store);
      const result = fn(store);
      try {
        await saveSnapshot(store, loaded.version);
        return result;
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "STORE_VERSION_CONFLICT" && attempt < maxAttempts - 1) {
          continue;
        }
        throw err;
      }
    }
    throw new Error("Store write failed after retries");
  });
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function getStoreInfo() {
  return { backend: getStoreBackendKind() };
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
  modelRequested?: string | null;
  modelResolved: string;
  modelReason: string;
  kind?: JobKind;
  projectId?: string | null;
  stepId?: string | null;
  agentProfile?: AgentProfile;
  creditCost?: number;
}) {
  return mutate((store) => {
    const account = store.accounts.find((a) => a.id === input.accountId);
    if (!account) throw new Error("Account not found");
    const cost = input.creditCost ?? CREDITS_PER_JOB;
    if (account.credits < cost) {
      throw new Error(`Need ${cost} credits; balance is ${account.credits}`);
    }
    const now = new Date().toISOString();
    account.credits -= cost;
    account.updatedAt = now;
    const job: CodingJob = {
      id: randomUUID(),
      accountId: input.accountId,
      prompt: input.prompt.trim(),
      repoHint: input.repoHint?.trim() || null,
      modelRequested: input.modelRequested?.trim() || "auto",
      modelResolved: input.modelResolved,
      modelReason: input.modelReason,
      kind: input.kind ?? "task",
      projectId: input.projectId ?? null,
      stepId: input.stepId ?? null,
      agentProfile: input.agentProfile ?? "coding",
      status: "queued",
      creditsCharged: cost,
      result: null,
      error: null,
      workerId: null,
      toolSteps: 0,
      events: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    store.jobs.push(job);

    if (job.projectId) {
      const project = store.projects.find((p) => p.id === job.projectId);
      if (project) {
        project.updatedAt = now;
        if (job.kind === "plan") {
          project.status = "planning";
          project.planJobId = job.id;
        } else if (job.kind === "step" && job.stepId) {
          project.status = "running";
          const step = project.steps.find((s) => s.id === job.stepId);
          if (step) {
            step.status = "queued";
            step.jobId = job.id;
          }
        }
      }
    }

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
    const now = new Date().toISOString();
    job.status = "running";
    job.updatedAt = now;
    if (!job.events) job.events = [];
    job.events.push({
      id: randomUUID(),
      t: now,
      type: "status",
      message: `Worker ${workerId} running`,
      data: null,
    });
    if (job.projectId && job.kind === "step" && job.stepId) {
      const project = store.projects.find((p) => p.id === job.projectId);
      const step = project?.steps.find((s) => s.id === job.stepId);
      if (project && step) {
        step.status = "running";
        project.status = "running";
        project.updatedAt = now;
      }
    }
    return job;
  });
}

const MAX_JOB_EVENTS = 200;

export async function appendJobEvent(input: {
  jobId: string;
  workerId: string;
  type: JobEventType;
  message: string;
  data?: Record<string, unknown> | null;
}) {
  return mutate((store) => {
    const job = store.jobs.find((j) => j.id === input.jobId);
    if (!job) throw new Error("Job not found");
    if (job.workerId !== input.workerId) throw new Error("Worker mismatch");
    if (job.status === "completed" || job.status === "failed") {
      throw new Error("Job already finished");
    }
    const now = new Date().toISOString();
    if (!job.events) job.events = [];
    const event: JobEvent = {
      id: randomUUID(),
      t: now,
      type: input.type,
      message: String(input.message || "").slice(0, 2000),
      data: input.data ?? null,
    };
    // Tokens stay mostly on the live bus to avoid snapshot write storms.
    const persist =
      input.type !== "token" ||
      Boolean((input.data as { persist?: boolean } | null)?.persist);
    if (persist) {
      job.events.push(event);
      if (job.events.length > MAX_JOB_EVENTS) {
        job.events = job.events.slice(-MAX_JOB_EVENTS);
      }
    }
    pushLiveEvent(job.id, event);
    job.updatedAt = now;
    return { job, event };
  });
}

function parsePlanPayload(result: string): {
  title?: string;
  steps: { title: string; prompt: string }[];
} | null {
  const marker = result.match(
    /<!--PLAN_JSON\s*([\s\S]*?)\s*PLAN_JSON-->/i,
  );
  const raw = marker?.[1]?.trim() || null;
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      title?: string;
      steps?: { title?: string; prompt?: string }[];
    };
    const steps = (data.steps ?? [])
      .map((s) => ({
        title: (s.title ?? "").trim(),
        prompt: (s.prompt ?? "").trim(),
      }))
      .filter((s) => s.title && s.prompt)
      .slice(0, 12);
    if (steps.length === 0) return null;
    return { title: data.title?.trim(), steps };
  } catch {
    return null;
  }
}

function summarizeResult(result: string, max = 280): string {
  const cleaned = result
    .replace(/<!--PLAN_JSON[\s\S]*?PLAN_JSON-->/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

export async function completeJob(input: {
  jobId: string;
  workerId: string;
  result?: string | null;
  error?: string | null;
  toolSteps?: number;
}) {
  const finished = await mutate((store) => {
    const job = store.jobs.find((j) => j.id === input.jobId);
    if (!job) throw new Error("Job not found");
    if (job.workerId !== input.workerId) throw new Error("Worker mismatch");
    const now = new Date().toISOString();
    if (typeof input.toolSteps === "number") {
      job.toolSteps = Math.max(0, input.toolSteps);
    }
    if (input.error) {
      job.status = "failed";
      job.error = input.error;
      const account = store.accounts.find((a) => a.id === job.accountId);
      if (account) {
        account.credits += job.creditsCharged;
        account.updatedAt = now;
      }
      if (job.projectId) {
        const project = store.projects.find((p) => p.id === job.projectId);
        if (project) {
          project.updatedAt = now;
          if (job.kind === "plan") project.status = "failed";
          if (job.kind === "step" && job.stepId) {
            const step = project.steps.find((s) => s.id === job.stepId);
            if (step) step.status = "failed";
            project.status = "failed";
          }
        }
      }
    } else {
      job.status = "completed";
      job.result = input.result ?? "";
      job.error = null;

      if (job.projectId) {
        const project = store.projects.find((p) => p.id === job.projectId);
        if (project) {
          project.updatedAt = now;
          if (job.kind === "plan") {
            const plan = parsePlanPayload(job.result);
            if (plan) {
              if (plan.title) project.title = plan.title.slice(0, 120);
              project.steps = plan.steps.map((s) => ({
                id: randomUUID(),
                title: s.title.slice(0, 160),
                prompt: s.prompt,
                status: "pending" as const,
                jobId: null,
                resultSummary: null,
              }));
              project.status = "planned";
            } else {
              project.status = "failed";
              job.error =
                "Plan job finished but no <!--PLAN_JSON ... PLAN_JSON--> checklist was found";
              job.status = "failed";
            }
          } else if (job.kind === "step" && job.stepId) {
            const step = project.steps.find((s) => s.id === job.stepId);
            if (step) {
              step.status = "completed";
              step.resultSummary = summarizeResult(job.result);
            }
            const allDone = project.steps.every(
              (s) => s.status === "completed" || s.status === "skipped",
            );
            project.status = allDone ? "completed" : "planned";
          }
        }
      }
    }
    job.updatedAt = now;
    job.completedAt = now;
    return job;
  });
  clearLiveEvents(input.jobId);
  return finished;
}

export async function listProjects(accountId: string) {
  const store = await readStore();
  return store.projects
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(projectId: string) {
  const store = await readStore();
  return store.projects.find((p) => p.id === projectId) ?? null;
}

export async function createProject(input: {
  accountId: string;
  goal: string;
  modelRequested: string;
  agentProfile: AgentProfile;
  title?: string;
}) {
  return mutate((store) => {
    const account = store.accounts.find((a) => a.id === input.accountId);
    if (!account) throw new Error("Account not found");
    const now = new Date().toISOString();
    const goal = input.goal.trim();
    const project: Project = {
      id: randomUUID(),
      accountId: input.accountId,
      title: (input.title?.trim() || goal.slice(0, 72) || "Untitled project").slice(
        0,
        120,
      ),
      goal,
      status: "draft",
      steps: [],
      modelRequested: input.modelRequested,
      agentProfile: input.agentProfile,
      planJobId: null,
      createdAt: now,
      updatedAt: now,
    };
    store.projects.push(project);
    return { project, account };
  });
}

export async function updateProjectSteps(
  projectId: string,
  accountId: string,
  steps: { id?: string; title: string; prompt: string }[],
) {
  return mutate((store) => {
    const project = store.projects.find(
      (p) => p.id === projectId && p.accountId === accountId,
    );
    if (!project) throw new Error("Project not found");
    if (project.status === "planning" || project.status === "running") {
      throw new Error("Cannot edit steps while a job is in flight");
    }
    const now = new Date().toISOString();
    project.steps = steps.slice(0, 12).map((s) => {
      const existing = s.id
        ? project.steps.find((x) => x.id === s.id)
        : undefined;
      const step: ProjectStep = {
        id: existing?.id ?? randomUUID(),
        title: s.title.trim().slice(0, 160),
        prompt: s.prompt.trim(),
        status: existing?.status === "completed" ? "completed" : "pending",
        jobId: existing?.status === "completed" ? existing.jobId : null,
        resultSummary:
          existing?.status === "completed" ? existing.resultSummary : null,
      };
      return step;
    });
    project.status = project.steps.length ? "planned" : "draft";
    project.updatedAt = now;
    return project;
  });
}

export async function skipProjectStep(
  projectId: string,
  accountId: string,
  stepId: string,
) {
  return mutate((store) => {
    const project = store.projects.find(
      (p) => p.id === projectId && p.accountId === accountId,
    );
    if (!project) throw new Error("Project not found");
    const step = project.steps.find((s) => s.id === stepId);
    if (!step) throw new Error("Step not found");
    if (step.status === "queued" || step.status === "running") {
      throw new Error("Step already in flight");
    }
    step.status = "skipped";
    step.resultSummary = step.resultSummary ?? "Skipped by user";
    const allDone = project.steps.every(
      (s) => s.status === "completed" || s.status === "skipped",
    );
    project.status = allDone ? "completed" : "planned";
    project.updatedAt = new Date().toISOString();
    return project;
  });
}

/** Build the prompt for the next pending project step (includes prior context). */
export function buildStepPrompt(project: Project, step: ProjectStep): string {
  const prior = project.steps
    .filter((s) => s.status === "completed" || s.status === "skipped")
    .map((s, i) => {
      const body = s.resultSummary || "(no summary)";
      return `${i + 1}. ${s.title} [${s.status}]\n${body}`;
    })
    .join("\n\n");

  const index = project.steps.findIndex((s) => s.id === step.id) + 1;
  return [
    `You are working project "${project.title}".`,
    `Overall goal:\n${project.goal}`,
    "",
    prior ? `Completed so far:\n${prior}` : "No prior steps completed yet.",
    "",
    `Current step (${index}/${project.steps.length}): ${step.title}`,
    "Do only this step. When finished, summarize what changed and what the next step should know.",
    "",
    "Step instructions:",
    step.prompt,
  ].join("\n");
}

export async function getPayments(accountId: string) {
  const store = await readStore();
  return store.payments
    .filter((p) => p.accountId === accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
