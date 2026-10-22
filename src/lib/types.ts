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
  /** GitHub login when OAuth-connected */
  githubLogin: string | null;
  /** AES-GCM packed access token — never send to the browser */
  githubTokenEnc: string | null;
  githubConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Public account shape returned to the browser (no password / token secrets). */
export type PublicAccount = Omit<Account, "passwordHash" | "githubTokenEnc"> & {
  githubConnected: boolean;
};

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

export interface Project {
  id: string;
  accountId: string;
  title: string;
  /** Linked GitHub repo as owner/name */
  githubRepo: string | null;
  githubDefaultBranch: string | null;
  /** When true (default), worker opens a PR after a successful turn */
  githubOpenPr: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CodingJob {
  id: string;
  accountId: string;
  /** Persistent project this turn belongs to (shared workspace). */
  projectId: string | null;
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
  /** Relative workspace key under account: `projects/{id}` or `{jobId}` */
  workspaceId: string | null;
  workspaceFileCount: number;
  /** Branch the worker pushed for this turn (GitHub-linked projects). */
  githubBranch: string | null;
  /** Pull request URL opened by the worker, if any. */
  githubPrUrl: string | null;
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
