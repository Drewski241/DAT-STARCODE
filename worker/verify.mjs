/**
 * Lightweight post-job checks for niche deliverables (e.g. ChiaLisp).
 */

import { secureTreasuryFailures } from "./secure-checks.mjs";

const COMMON_LISP_BAD =
  /\b(defparameter|defvar|mapcar|progn|setf|getf|loop\s+for)\b|\(let\*/i;
const INDEX_SYNTAX = /\w+\s*\[\s*\d+\s*\]/;
const AGG_SIG_AS_IF = /\(\s*if\s*\(\s*AGG_SIG_ME\b/i;
const DEADBEEF = /0xDEADBEEF/i;
const AGG_SIG_UNSAFE = /\bAGG_SIG_UNSAFE\b|\(list\s+49\b/i;
const HAS_CREATE_COIN = /\bCREATE_COIN\b|\(list\s+51\b/i;
const HAS_AGG_SIG_ME = /\bAGG_SIG_ME\b|\(list\s+50\b/i;
const HAS_ASSERT_MY = /\bASSERT_MY_(AMOUNT|PUZZLEHASH|COIN_ID)\b|\(list\s+7[0-3]\b/i;

/**
 * True if any single condition-list contains two CREATE_COIN / (list 51 …) siblings.
 * Mutually exclusive modes each with one CREATE_COIN are OK (separate parent lists).
 */
export function hasSiblingCreateCoins(source) {
  const s = String(source || "").replace(/;.*$/gm, "\n");
  /** @type {{ childCreates: number }[]} */
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      const rest = s.slice(i);
      const isCreate =
        /^\(\s*list\s+51\b/i.test(rest) || /^\(\s*CREATE_COIN\b/i.test(rest);
      stack.push({ childCreates: 0 });
      if (isCreate && stack.length >= 2) {
        const parent = stack[stack.length - 2];
        parent.childCreates += 1;
        if (parent.childCreates >= 2) return true;
      }
    } else if (ch === ")") {
      stack.pop();
    }
  }
  return false;
}

/**
 * Extract a bare 64-char hex puzzle hash from ## Puzzle hash (or legacy ## Pool puzzle hash).
 * Rejects `0x…` placeholders (x is a hex digit so naive {64} matches lie).
 */
export function findBarePuzzleHash(text) {
  const s = String(text || "");
  const section = s.match(/##\s*(?:Pool\s+)?[Pp]uzzle hash\s*\n([\s\S]{0,500})/i);
  if (!section) return null;
  const chunk = section[1].split(/\n##\s+/)[0] || "";
  // Strip 0x-prefixed tokens so they cannot satisfy the bare-hash check.
  const scrubbed = chunk.replace(/0x[0-9a-fA-F]+/gi, "OX_STRIPPED");
  const m = scrubbed.match(/(^|[^0-9a-fA-F])([0-9a-fA-F]{64})([^0-9a-fA-F]|$)/);
  return m ? m[2].toLowerCase() : null;
}

/**
 * @param {{ path: string, content: string }[]} files
 * @param {{
 *   requireHash?: boolean,
 *   resultText?: string,
 *   toolingOk?: boolean,
 *   toolingMissing?: string[],
 *   strictSingleton?: boolean,
 *   secureTreasury?: boolean,
 * }} [opts]
 * @returns {{ ok: boolean, failures: string[], warnings: string[] }}
 */
export function verifyWorkspaceFiles(files, opts = {}) {
  const failures = [];
  const warnings = [];
  const clspFiles = files.filter((f) => /\.clsp$/i.test(f.path));
  const strictSingleton = Boolean(opts.strictSingleton);
  const secureTreasury =
    Boolean(opts.secureTreasury) ||
    clspFiles.some((f) => /puzzles\/savings_vault\.clsp$/i.test(f.path));

  for (const f of clspFiles) {
    const body = String(f.content || "");
    // Skip blank lines and ; comments before the program body.
    const trimmed = body
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return t.length > 0 && !t.startsWith(";");
      })
      .join("\n")
      .trimStart();
    if (!trimmed.startsWith("(mod")) {
      failures.push(
        `${f.path}: ChiaLisp must start with (mod — got: ${trimmed.slice(0, 40).replace(/\n/g, " ")}`,
      );
    }
    if (COMMON_LISP_BAD.test(body)) {
      failures.push(
        `${f.path}: contains Common Lisp forms (defparameter/let*/mapcar/…) — not valid ChiaLisp`,
      );
    }
    if (INDEX_SYNTAX.test(body)) {
      failures.push(
        `${f.path}: array index syntax like xs[0] is not ChiaLisp — use f/r`,
      );
    }
    if (AGG_SIG_AS_IF.test(body)) {
      failures.push(
        `${f.path}: AGG_SIG_ME used as if-predicate — emit it as a condition instead`,
      );
    }
    if (DEADBEEF.test(body)) {
      failures.push(
        `${f.path}: still contains 0xDEADBEEF — use curried POOL_PUZZLE_HASH`,
      );
    }
    if (AGG_SIG_UNSAFE.test(body)) {
      warnings.push(
        `${f.path}: uses AGG_SIG_UNSAFE — prefer AGG_SIG_ME unless replay across coins is impossible (document why)`,
      );
    }
    if (
      HAS_CREATE_COIN.test(body) &&
      !HAS_AGG_SIG_ME.test(body) &&
      !HAS_ASSERT_MY.test(body)
    ) {
      warnings.push(
        `${f.path}: CREATE_COIN without AGG_SIG_ME or ASSERT_MY_* — confirm destinations are curried/derived, not attacker-chosen solution atoms`,
      );
    }
    if (hasSiblingCreateCoins(body)) {
      const msg = `${f.path}: sibling CREATE_COIN conditions in one spend — singleton vaults/treasuries must emit exactly one child (CircuitDAO lineage-spoof class)`;
      if (strictSingleton) failures.push(msg);
      else warnings.push(msg);
    }
  }

  // Hard-domain jobs: missing worker tooling is a hard fail (no "cdv missing" escape).
  if (opts.toolingOk === false) {
    const missing = Array.isArray(opts.toolingMissing)
      ? opts.toolingMissing.join(", ")
      : "cdv and/or clvm_tools";
    failures.push(
      `Worker missing required ChiaLisp tooling (${missing}). Install chia-dev-tools (cdv) and npm deps (clvm_tools), then restart the worker.`,
    );
  }

  if (clspFiles.length && opts.requireHash) {
    const docs = files
      .filter((f) => /\.md$/i.test(f.path))
      .map((f) => f.content)
      .join("\n");
    const corpus = [opts.resultText || "", docs].join("\n");
    const hasSection = /##\s*(?:Pool\s+)?[Pp]uzzle hash/i.test(corpus);
    const bareHash = findBarePuzzleHash(corpus);
    if (!hasSection) {
      failures.push(
        "Wrote .clsp but missing ## Puzzle hash section in docs/PUZZLE_HASH.md — run puzzle_hash tool and document the bare hex",
      );
    } else if (!bareHash) {
      failures.push(
        "## Puzzle hash must contain a bare 64-char hex from puzzle_hash/cdv (no 0x prefix / no placeholders)",
      );
    }
  }

  if (secureTreasury) {
    failures.push(...secureTreasuryFailures(files));
  }

  return { ok: failures.length === 0, failures, warnings };
}

/**
 * @param {string} prompt
 * @deprecated prefer inferGoal from goals.mjs
 */
export function wantsChialisp(prompt) {
  return /\b(\.clsp|chialisp|chia\s*lisp|clvm|pool\s*coin|mtt_pool)\b/i.test(
    String(prompt || ""),
  );
}
