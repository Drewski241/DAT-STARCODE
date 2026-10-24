/**
 * Static secure-puzzle heuristics for treasury / vault ChiaLisp.
 * Complements sibling-CREATE_COIN checks in verify.mjs.
 */

import {
  LIST_CURRY_TREEHASH,
  C_CURRY_TREEHASH,
  checkCurryTreehashShape,
} from "./curry-check.mjs";

/** Puzzle announcement create / assert (prefer over coin announcements for PH pairing). */
const CREATE_PUZZLE_ANNOUNCEMENT = /\(list\s+63\b|\bCREATE_PUZZLE_ANNOUNCEMENT\b/i;
const ASSERT_PUZZLE_ANNOUNCEMENT = /\(list\s+61\b|\bASSERT_PUZZLE_ANNOUNCEMENT\b/i;
const ASSERT_MY_AMOUNT = /\(list\s+73\b|\bASSERT_MY_AMOUNT\b/i;

/**
 * Extract a top-level (defun name …) body (best-effort, balanced parens from defun).
 * @param {string} s
 * @param {string} name
 */
function defunBody(s, name) {
  const re = new RegExp(`\\(defun\\s+${name}\\b`, "i");
  const m = re.exec(s);
  if (!m) return "";
  let i = m.index;
  let depth = 0;
  for (; i < s.length; i++) {
    if (s[i] === "(") depth += 1;
    else if (s[i] === ")") {
      depth -= 1;
      if (depth === 0) return s.slice(m.index, i + 1);
    }
  }
  return s.slice(m.index);
}

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
  failures.push(...checkCurryTreehashShape(s, path));
  if (!ASSERT_PUZZLE_ANNOUNCEMENT.test(s) && /interest|owed|TREASURY_PH/i.test(s)) {
    failures.push(
      `${path}: interest claim should ASSERT_PUZZLE_ANNOUNCEMENT (61) against TREASURY_PH (not a mismatched coin announcement)`,
    );
  }
  // Mode-4 claim-only must reset accrual clock (DEPOSIT_SECONDS := now_seconds).
  if (/\bmode-claim-only\b/i.test(s) || /=\s*mode\s+4\b/.test(s)) {
    const claim = defunBody(s, "mode-claim-only");
    if (claim) {
      if (/PRINCIPAL\s+DEPOSIT_SECONDS\s+OWNER_PH/i.test(claim)) {
        failures.push(
          `${path}: mode-4 claim-only recreates with DEPOSIT_SECONDS (stale clock) — pass now_seconds so accrual cannot be claimed twice`,
        );
      } else if (
        /vault-ph/i.test(claim) &&
        !/PRINCIPAL\s+now_seconds\s+OWNER_PH/i.test(claim)
      ) {
        failures.push(
          `${path}: mode-4 claim-only must recreate vault with deposit_seconds := now_seconds`,
        );
      }
    }
  }
  // claim-msg must bind OWNER_PH (not a free dest_ph).
  if (/\bclaim-msg\b/i.test(s) && /\bOWNER_PH\b/.test(s)) {
    const cm = defunBody(s, "claim-msg");
    if (cm && /\bdest_ph\b/i.test(cm) && !/\bOWNER_PH\b/.test(cm)) {
      failures.push(
        `${path}: claim-msg must include OWNER_PH (not a free dest_ph) so vault/treasury/payout digests match`,
      );
    }
  }
  // Nullary mode defuns close over free mod params — cdv/brun raise (zip fdcb9b56).
  const code = s.replace(/;.*$/gm, "\n");
  if (
    /\(defun\s+mode-(?:open|withdraw)\s*\(\s*\)/i.test(code) ||
    /\(defun\s+mode-(?:exit-with-interest|claim-only)\s*\(\s*elapsed\s+owed\s*\)/i.test(
      code,
    )
  ) {
    failures.push(
      `${path}: mode helpers must not be nullary / close over free mod params — keep mode branches inline (cdv/brun otherwise raise)`,
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
  failures.push(...checkCurryTreehashShape(s, path));
  if (!CREATE_PUZZLE_ANNOUNCEMENT.test(s)) {
    failures.push(
      `${path}: missing CREATE_PUZZLE_ANNOUNCEMENT (63) — vault/payout must assert the same puzzle announcement message`,
    );
  }
  // Free dest_ph without OWNER_PH lets interest be redirected (ignore ; comments).
  const code = s.replace(/;.*$/gm, "\n");
  if (/\bdest_ph\b/i.test(code) && !/\bOWNER_PH\b/.test(code)) {
    failures.push(
      `${path}: interest claim uses free dest_ph — bind claim-msg / solution to OWNER_PH (match vault + payout)`,
    );
  }
  if (/\(defun\s+pay-interest\s*\(\s*\)/i.test(code)) {
    failures.push(
      `${path}: nullary pay-interest closes over free mod params — inline the pay path (cdv/brun otherwise raise)`,
    );
  }
  return failures;
}

/**
 * Interest payout must curry OWNER_PH and CREATE_COIN only to that owner.
 * @param {string} body
 * @param {string} path
 * @returns {string[]}
 */
export function checkPayoutSecure(body, path = "interest_payout.clsp") {
  const failures = [];
  const s = String(body || "");
  const code = s.replace(/;.*$/gm, "\n");
  if (!/\bOWNER_PH\b/.test(code)) {
    failures.push(
      `${path}: must curry OWNER_PH — interest cannot be redirected via a free dest_ph`,
    );
  }
  if (/\bdest_ph\b/i.test(code)) {
    failures.push(
      `${path}: free dest_ph allows redirecting interest — CREATE_COIN must pay curried OWNER_PH only`,
    );
  }
  if (
    /\bOWNER_PH\b/.test(code) &&
    !/\(list\s+51\s+\(assert-b32\s+OWNER_PH\)|\(list\s+51\s+OWNER_PH\b/i.test(code)
  ) {
    failures.push(
      `${path}: CREATE_COIN (51) must pay curried OWNER_PH`,
    );
  }
  if (!ASSERT_PUZZLE_ANNOUNCEMENT.test(code)) {
    failures.push(
      `${path}: must ASSERT_PUZZLE_ANNOUNCEMENT (61) with the same claim-msg as treasury`,
    );
  }
  return failures;
}

/**
 * Cross-file announcement message agreement (best-effort static).
 * @param {string} vaultBody
 * @param {string} treasuryBody
 * @param {string} [payoutBody]
 * @returns {string[]}
 */
export function checkAnnouncementPairing(vaultBody, treasuryBody, payoutBody) {
  const failures = [];
  const v = String(vaultBody || "");
  const t = String(treasuryBody || "");
  const p = String(payoutBody || "");
  if (!v || !t) return failures;

  const vaultAssertsPuzzle = ASSERT_PUZZLE_ANNOUNCEMENT.test(v);
  const treasuryCreatesPuzzle = CREATE_PUZZLE_ANNOUNCEMENT.test(t);
  if (vaultAssertsPuzzle && !treasuryCreatesPuzzle) {
    failures.push(
      "Announcement pairing: vault asserts puzzle announcement (61) but treasury never CREATE_PUZZLE_ANNOUNCEMENT (63)",
    );
  }

  const ownerClaim = (src) =>
    /sha256tree\s*\(\s*list[^)]*OWNER_PH/i.test(src) ||
    /claim-msg[\s\S]{0,200}OWNER_PH/i.test(src);
  const destClaim = (src) => /sha256tree\s*\(\s*list[^)]*dest_ph/i.test(src);

  if (vaultAssertsPuzzle && treasuryCreatesPuzzle) {
    if (ownerClaim(v) && !ownerClaim(t) && destClaim(t)) {
      failures.push(
        "Announcement pairing: vault claim-msg binds OWNER_PH but treasury still uses dest_ph — digests will not match",
      );
    }
    if (destClaim(v) && !destClaim(t) && !ownerClaim(t)) {
      failures.push(
        "Announcement pairing: vault claim message includes dest_ph but treasury claim message does not — digests will not match",
      );
    }
  }

  if (p && treasuryCreatesPuzzle) {
    if (!ASSERT_PUZZLE_ANNOUNCEMENT.test(p)) {
      failures.push(
        "Announcement pairing: interest_payout must ASSERT_PUZZLE_ANNOUNCEMENT (61) against treasury's claim-msg",
      );
    }
    if (ownerClaim(t) && !ownerClaim(p)) {
      failures.push(
        "Announcement pairing: treasury claim-msg binds OWNER_PH but payout does not — digests will not match",
      );
    }
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
  if (payout) failures.push(...checkPayoutSecure(payout.content, payout.path));
  if (vault && treasury) {
    failures.push(
      ...checkAnnouncementPairing(
        vault.content,
        treasury.content,
        payout?.content,
      ),
    );
  }
  if (vault && treasury && !payout) {
    failures.push(
      "Missing puzzles/interest_payout.clsp — need a third spend that CREATE_COINs interest to OWNER_PH after asserting the treasury puzzle announcement",
    );
  }
  return failures;
}

export { LIST_CURRY_TREEHASH, C_CURRY_TREEHASH, checkCurryTreehashShape };
