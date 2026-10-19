/**
 * DAT STARCODER credit economy — slow burn vs fixed supply.
 *
 * DAT Governance Token total supply ≈ 150,000,000 (fixed CAT2).
 * We size prices so that even continuous full-load usage would only
 * burn a small fraction of supply over a century — DAT never runs out
 * in practice, and each job is a tiny permanent burn.
 *
 * Formula:
 *   centuryBudget = SUPPLY × CENTURY_BURN_FRACTION
 *   datPerCredit  = centuryBudget / (100y × days × maxCreditsPerDay)
 *   creditsPerDat = 1 / datPerCredit
 *
 * Pack DAT amounts are derived from desired credit grants so the UI
 * always stays consistent with the formula.
 */

export const DAT_TOTAL_SUPPLY = 150_000_000;

/** Share of total supply we allow the service to burn over 100 years at full load. */
export const CENTURY_BURN_FRACTION = 0.1; // 10% of supply in 100 years

/** Conservative full-load assumption (jobs × credits), continuous. */
export const ASSUMED_MAX_CREDITS_PER_DAY = 2_000;

const DAYS_PER_CENTURY = 100 * 365.25;

export const CENTURY_BURN_BUDGET = DAT_TOTAL_SUPPLY * CENTURY_BURN_FRACTION;

export const DAT_PER_CREDIT =
  CENTURY_BURN_BUDGET / (DAYS_PER_CENTURY * ASSUMED_MAX_CREDITS_PER_DAY);

/** Credits granted per 1 DAT burned (derived). */
export const CREDITS_PER_DAT = 1 / DAT_PER_CREDIT;

/** Round DAT amounts for display/settlement without under-charging. */
export function datForCredits(credits: number): number {
  const raw = credits * DAT_PER_CREDIT;
  // 4 decimal places is enough for a slow-burn CAT; never round down below cost.
  return Math.ceil(raw * 10_000) / 10_000;
}

export function creditsForDat(dat: number): number {
  return Math.floor(dat * CREDITS_PER_DAT);
}

/** Human-readable summary of the economy for the pay UI. */
export function economyBlurb(): string {
  const cpd = CREDITS_PER_DAT;
  return (
    `Supply ${DAT_TOTAL_SUPPLY.toLocaleString("en-US")} DAT. ` +
    `Target: burn ≤${CENTURY_BURN_FRACTION * 100}% over 100 years at full load ` +
    `(≈${ASSUMED_MAX_CREDITS_PER_DAY.toLocaleString("en-US")} credits/day). ` +
    `Rate ≈ ${cpd.toFixed(2)} credits per DAT.`
  );
}

/**
 * Credit packs defined by credits first; DAT cost follows the formula.
 * Small DAT burns keep the token circulating for a very long time.
 */
export const CREDIT_PACK_DEFS = [
  {
    id: "spark",
    label: "Spark",
    credits: 50,
    blurb: "A few short tasks",
  },
  {
    id: "forge",
    label: "Forge",
    credits: 250,
    blurb: "A solid work session",
  },
  {
    id: "foundry",
    label: "Foundry",
    credits: 1_000,
    blurb: "Heavy multi-file jobs",
  },
] as const;

export type CreditPack = {
  id: string;
  label: string;
  blurb: string;
  credits: number;
  dat: number;
};

export function getCreditPacks(): CreditPack[] {
  return CREDIT_PACK_DEFS.map((pack) => ({
    id: pack.id,
    label: pack.label,
    blurb: pack.blurb,
    credits: pack.credits,
    dat: datForCredits(pack.credits),
  }));
}

export function getPackById(packId: string): CreditPack | undefined {
  return getCreditPacks().find((p) => p.id === packId);
}
