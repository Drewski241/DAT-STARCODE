/**
 * DAT (DAT Governance Token) on Chia — CAT2 asset id from Spacescan.
 * Override via env if you settle on a different DAT CAT later.
 */
export const DAT_ASSET_ID =
  process.env.NEXT_PUBLIC_DAT_ASSET_ID ??
  "d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c";

export const DAT_SYMBOL = "DAT";

/** How many agent credits one DAT buys (tune for your cost of GPU time). */
export const CREDITS_PER_DAT = Number(process.env.NEXT_PUBLIC_CREDITS_PER_DAT ?? 10);

/** Credits burned per coding job. */
export const CREDITS_PER_JOB = Number(process.env.CREDITS_PER_JOB ?? 5);

/**
 * Official Chia mainnet burn address — DAT spent for credits is sent here
 * and is unspendable forever.
 * @see https://docs.chia.net/chia-blockchain/coin-set-model/addresses/
 */
export const DAT_BURN_ADDRESS =
  process.env.NEXT_PUBLIC_DAT_BURN_ADDRESS ??
  "xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqm6ks6e8mvy";

export const WORKER_API_KEY =
  process.env.WORKER_API_KEY ?? "dev-worker-key-change-me";

export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const APP_NAME = "DAT STARCODER";
export const APP_TAGLINE = "Coding agent, paid in DAT";

/** Session cookie name for credit accounts. */
export const ACCOUNT_COOKIE = "dat_starcoder_account";

export const CREDIT_PACKS = [
  { id: "spark", dat: 10, label: "Spark", blurb: "A few short tasks" },
  { id: "forge", dat: 50, label: "Forge", blurb: "A solid work session" },
  { id: "foundry", dat: 200, label: "Foundry", blurb: "Heavy multi-file jobs" },
] as const;
