export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PaymentStatus = "pending" | "confirmed" | "failed" | "demo";

export interface Account {
  id: string;
  walletAddress: string | null;
  credits: number;
  createdAt: string;
  updatedAt: string;
}

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
  /** User-facing choice (may be "auto"). */
  modelRequested: string;
  /** Concrete Ollama tag after Auto resolution. */
  modelResolved: string;
  modelReason: string;
  status: JobStatus;
  creditsCharged: number;
  result: string | null;
  error: string | null;
  workerId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface StoreSnapshot {
  accounts: Account[];
  payments: PaymentIntent[];
  jobs: CodingJob[];
}
