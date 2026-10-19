/** DAT CAT uses 3 decimal places (1 DAT = 1000 mojos), same as DAT ecosystem apps. */
export const DAT_MOJOS_PER_UNIT = 1000;

/** Default XCH fee for a CAT send (0.0001 XCH). */
export const DEFAULT_XCH_FEE_MOJOS = 100_000_000;

export function datToMojos(dat: number): string {
  if (!Number.isFinite(dat) || dat <= 0) {
    throw new Error("DAT amount must be positive");
  }
  // Avoid float drift: work in 1e4 micro-units then scale to mojos.
  const micro = Math.round(dat * 10_000);
  const mojos = Math.floor((micro * DAT_MOJOS_PER_UNIT) / 10_000);
  if (mojos <= 0) throw new Error("DAT amount too small");
  return String(mojos);
}

export function mojosToDat(mojos: string | number): number {
  const n = typeof mojos === "number" ? mojos : Number(mojos);
  if (!Number.isFinite(n)) return 0;
  return n / DAT_MOJOS_PER_UNIT;
}
