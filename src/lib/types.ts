export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PaymentStatus = "pending" | "confirmed" | "failed" | "demo";

export type AccountSource = "local" | "spirit-poker";

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

export interface CodingJob {
  id: string;
  accountId: string;
  prompt: string;
  repoHint: string | null;
  /** Prior job this continues from (follow-up prompts). */
  parentJobId: string | null;
  /** Extra context injected for the worker (prior result / files). */
  context: string | null;
  modelRequested: string;
  modelResolved: string;
  modelReason: string;
  status: JobStatus;
  creditsCharged: number;
  result: string | null;
  error: string | null;
  workerId: string | null;
  /** Relative workspace key: `{accountId}/{jobId}` */
  workspaceId: string | null;
  workspaceFileCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface StoreSnapshot {
  accounts: Account[];
  payments: PaymentIntent[];
  jobs: CodingJob[];
}
