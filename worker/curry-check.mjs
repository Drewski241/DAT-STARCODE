/**
 * Curry recreation hash shape checks for vault/treasury ChiaLisp.
 * Recreation must use (sha256tree (c MOD_HASH|mod_hash (list …))), not a flat
 * (sha256tree (list MOD_HASH …)) — the latter will not match cdv curry.
 */

/** Wrong: (sha256tree (list MOD_HASH …)) / (sha256tree (list mod_hash …)). */
export const LIST_CURRY_TREEHASH =
  /sha256tree\s*\(\s*list\s+(?:MOD_HASH|mod_hash)\b/i;

/** Correct: (sha256tree (c MOD_HASH|mod_hash …)) or (c MOD_HASH (list …)). */
export const C_CURRY_TREEHASH =
  /sha256tree\s*\(\s*c\s+(?:MOD_HASH|mod_hash)\b|\(c\s+(?:MOD_HASH|mod_hash)\s+\(list/i;

/**
 * @param {string} body
 * @param {string} path
 * @returns {string[]}
 */
export function checkCurryTreehashShape(body, path = "puzzle.clsp") {
  const failures = [];
  const s = String(body || "");
  if (!/\b(?:MOD_HASH|mod_hash)\b/.test(s)) return failures;
  if (LIST_CURRY_TREEHASH.test(s) && !C_CURRY_TREEHASH.test(s)) {
    failures.push(
      `${path}: recreation uses (sha256tree (list MOD_HASH …)) — use (sha256tree (c MOD_HASH (list …))) and confirm with cdv curry / puzzle_hash`,
    );
  }
  // Recreation helpers present but never use (c …) shape.
  if (
    /\b(?:vault-ph|treasury-ph)\b/i.test(s) &&
    !C_CURRY_TREEHASH.test(s) &&
    !LIST_CURRY_TREEHASH.test(s)
  ) {
    // Soft: helper exists; if it treehashes without c, still flag.
    if (/sha256tree\s*\(\s*list\b/i.test(s) && /\bMOD_HASH\b|\bmod_hash\b/.test(s)) {
      failures.push(
        `${path}: vault-ph/treasury-ph should curry via (c mod_hash (list …)) so the treehash matches cdv`,
      );
    }
  }
  return failures;
}
