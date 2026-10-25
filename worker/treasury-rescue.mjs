/**
 * Decide whether secure-treasury post-turn rescue should overwrite puzzles/.
 *
 * CircuitDAO v2 turns: reseed on secure-check failures OR any diverge from
 * tip-gold templates (models often "tweak" payout into cdv-raise forms).
 *
 * Real-funds turns: intentional diverge (OWNER_PK / TREASURY_PK). Only reseed
 * when static secure-checks fail — never wipe Phase B+ work for inequality alone.
 */

/**
 * @param {{
 *   rescueFails?: string[],
 *   diverged?: string[],
 *   allowTemplateDiverge?: boolean,
 * }} input
 * @returns {{ rescue: boolean, reason: string }}
 */
export function shouldRescueTreasuryPuzzles(input = {}) {
  const fails = Array.isArray(input.rescueFails) ? input.rescueFails : [];
  const diverged = Array.isArray(input.diverged) ? input.diverged : [];
  const allowDiverge = Boolean(input.allowTemplateDiverge);

  if (fails.length) {
    return {
      rescue: true,
      reason: `secure-check: ${fails.slice(0, 3).join("; ")}`,
    };
  }
  if (!allowDiverge && diverged.length) {
    return {
      rescue: true,
      reason: diverged.map((d) => `${d} diverged from template`).join("; "),
    };
  }
  if (allowDiverge && diverged.length) {
    return {
      rescue: false,
      reason: `real-funds: keeping intentional diverge (${diverged.join(", ")})`,
    };
  }
  return { rescue: false, reason: "ok" };
}

/**
 * @param {{ playbooks?: string[] }|null|undefined} goal
 */
export function goalAllowsTreasuryTemplateDiverge(goal) {
  const books = Array.isArray(goal?.playbooks) ? goal.playbooks : [];
  return books.includes("secure-treasury-real-funds.md");
}
