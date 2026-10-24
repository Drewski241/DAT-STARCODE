export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PaymentStatus = "pending" | "confirmed" | "failed" | "demo";

export type AccountSource = "local" | "spirit-poker";

/** How the worker should specialize for this job. */
export type AgentProfile = "coding" | "general" | "chialisp" | "ops";

export type JobKind = "task" | "plan" | "step";

export type ProjectStatus =
  | "draft"
  | "planning"
  | "planned"
  | "running"
  | "completed"
  | "failed";

export type ProjectStepStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface Account {
  id: string;
  username: string | null;
  email: string | null;
  /** scrypt hash; null when account was linked via Spirit Poker only this session */
  passwordHash: string | null;
  pokerPlayerId: string | null;
  source: AccountSource;
  walletAddress: string | null;
  credits: number;
  createdAt: string;
  updatedAt: string;
}

/** Public account shape returned to the browser (no password hash). */
export type PublicAccount = Omit<Account, "passwordHash">;

export interface PaymentIntent {
  id: string;
  accountId: string;
  packId: string;
  datAmount: number;
  credits: number;
  status: PaymentStatus;
  memo: string;
  txId: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ProjectStep {
  id: string;
  title: string;
  prompt: string;
  status: ProjectStepStatus;
  jobId: string | null;
  resultSummary: string | null;
}

export interface Project {
  id: string;
  accountId: string;
  title: string;
  goal: string;
  status: ProjectStatus;
  steps: ProjectStep[];
  modelRequested: string;
  agentProfile: AgentProfile;
  planJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type JobEventType =
  | "status"
  | "tool"
  | "tool_result"
  | "log"
  | "token"
  | "error";

export interface JobEvent {
  id: string;
  t: string;
  type: JobEventType;
  message: string;
  data?: Record<string, unknown> | null;
}

export interface CodingJob {
  id: string;
  accountId: string;
  prompt: string;
  repoHint: string | null;
  modelRequested: string;
  modelResolved: string;
  modelReason: string;
  kind: JobKind;
  projectId: string | null;
  stepId: string | null;
  agentProfile: AgentProfile;
  status: JobStatus;
  creditsCharged: number;
  result: string | null;
  error: string | null;
  workerId: string | null;
  toolSteps: number;
  /** Live tool / status stream for Studio SSE. */
  events: JobEvent[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface StoreSnapshot {
  accounts: Account[];
  payments: PaymentIntent[];
  jobs: CodingJob[];
  projects: Project[];
}
