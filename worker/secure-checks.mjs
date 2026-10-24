/**
 * Static secure-puzzle heuristics for treasury / vault ChiaLisp.
 * Complements sibling-CREATE_COIN checks in verify.mjs.
 */

/** Puzzle announcement create / assert (prefer over coin announcements for PH pairing). */
const CREATE_PUZZLE_ANNOUNCEMENT = /\(list\s+63\b|\bCREATE_PUZZLE_ANNOUNCEMENT\b/i;
const ASSERT_PUZZLE_ANNOUNCEMENT = /\(list\s+61\b|\bASSERT_PUZZLE_ANNOUNCEMENT\b/i;
const ASSERT_MY_AMOUNT = /\(list\s+73\b|\bASSERT_MY_AMOUNT\b/i;
/** Wrong curry-treehash shape: (sha256tree (list MOD_HASH …)) instead of (c MOD_HASH …). */
const LIST_CURRY_TREEHASH =
  /sha256tree\s*\(\s*list\s+MOD_HASH\b/i;
const C_CURRY_TREEHASH =
  /sha256tree\s*\(\s*c\s+MOD_HASH\b|\(c\s+MOD_HASH\s+\(list/i;

/**
 * @param {string} body
 * @param {string} path
 * @returns {string[]}
 */
export function checkVaultSecure(body, path = "savings_vault.clsp") {
  const failures = [];
  const s = String(body || "");
  if (/\bOWNER_PH\b/.test(s)) {
    // Curry header alone does not count — must appear in a condition / equality.
    const withoutHeader = s.replace(
      /\(mod\s*\([\s\S]*?\)/,
      "(mod ()",
    );
    if (!/\bOWNER_PH\b/.test(withoutHeader)) {
      failures.push(
        `${path}: OWNER_PH is curried but unused — bind withdraw/claim destinations to OWNER_PH (or (= dest_ph OWNER_PH))`,
      );
    }
  }
  if (LIST_CURRY_TREEHASH.test(s) && !C_CURRY_TREEHASH.test(s)) {
    failures.push(
      `${path}: vault recreation uses (sha256tree (list MOD_HASH …)) — use (sha256tree (c MOD_HASH (list …))) and confirm with cdv curry`,
    );
  }
  if (!ASSERT_PUZZLE_ANNOUNCEMENT.test(s) && /interest|owed|TREASURY_PH/i.test(s)) {
    failures.push(
      `${path}: interest claim should ASSERT_PUZZLE_ANNOUNCEMENT (61) against TREASURY_PH (not a mismatched coin announcement)`,
    );
  }
  return failures;
}

/**
 * @param {string} body
 * @param {string} path
 * @returns {string[]}
 */
export function checkTreasurySecure(body, path = "treasury_coin.clsp") {
  const failures = [];
  const s = String(body || "");
  // Solution-driven amount without binding the coin.
  if (/\bamount\b/i.test(s) && !ASSERT_MY_AMOUNT.test(s)) {
    failures.push(
      `${path}: treasury spends solution \`amount\` without ASSERT_MY_AMOUNT (73) — bind the coin amount before subtracting interest`,
    );
  }
  if (LIST_CURRY_TREEHASH.test(s) && !C_CURRY_TREEHASH.test(s)) {
    failures.push(
      `${path}: treasury recreate uses (sha256tree (list MOD_HASH …)) — use (sha256tree (c MOD_HASH (list …)))`,
    );
  }
  if (!CREATE_PUZZLE_ANNOUNCEMENT.test(s)) {
    failures.push(
      `${path}: missing CREATE_PUZZLE_ANNOUNCEMENT (63) — vault/payout must assert the same puzzle announcement message`,
    );
  }
  return failures;
}

/**
 * Cross-file announcement message agreement (best-effort static).
 * @param {string} vaultBody
 * @param {string} treasuryBody
 * @returns {string[]}
 */
export function checkAnnouncementPairing(vaultBody, treasuryBody) {
  const failures = [];
  const v = String(vaultBody || "");
  const t = String(treasuryBody || "");
  if (!v || !t) return failures;

  const vaultAssertsPuzzle = ASSERT_PUZZLE_ANNOUNCEMENT.test(v);
  const treasuryCreatesPuzzle = CREATE_PUZZLE_ANNOUNCEMENT.test(t);
  if (vaultAssertsPuzzle && !treasuryCreatesPuzzle) {
    failures.push(
      "Announcement pairing: vault asserts puzzle announcement (61) but treasury never CREATE_PUZZLE_ANNOUNCEMENT (63)",
    );
  }
  // Soft: both should mention sha256tree claim shape with interest + dest.
  const vaultClaim = /sha256tree\s*\(\s*list[^)]*dest_ph/i.test(v);
  const treasuryClaim = /sha256tree\s*\(\s*list[^)]*dest_ph/i.test(t);
  if (vaultAssertsPuzzle && treasuryCreatesPuzzle && vaultClaim && !treasuryClaim) {
    failures.push(
      "Announcement pairing: vault claim message includes dest_ph but treasury claim message does not — digests will not match",
    );
  }
  return failures;
}

/**
 * Run secure-treasury static suite over workspace files.
 * @param {{ path: string, content: string }[]} files
 * @returns {string[]}
 */
export function secureTreasuryFailures(files) {
  const list = Array.isArray(files) ? files : [];
  const vault = list.find((f) => /puzzles\/savings_vault\.clsp$/i.test(f.path));
  const treasury = list.find((f) => /puzzles\/treasury_coin\.clsp$/i.test(f.path));
  const payout = list.find((f) => /puzzles\/interest_payout\.clsp$/i.test(f.path));
  /** @type {string[]} */
  const failures = [];
  if (vault) failures.push(...checkVaultSecure(vault.content, vault.path));
  if (treasury) failures.push(...checkTreasurySecure(treasury.content, treasury.path));
  if (vault && treasury) {
    failures.push(...checkAnnouncementPairing(vault.content, treasury.content));
  }
  if (vault && treasury && !payout) {
    failures.push(
      "Missing puzzles/interest_payout.clsp — need a third spend that CREATE_COINs interest to dest after asserting the treasury puzzle announcement",
    );
  }
  return failures;
}
