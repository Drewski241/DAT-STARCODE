/**
 * Lightweight post-job checks for niche deliverables (e.g. ChiaLisp).
 */

const COMMON_LISP_BAD =
  /\b(defparameter|defvar|mapcar|progn|setf|getf|loop\s+for)\b|\(let\*/i;
const INDEX_SYNTAX = /\w+\s*\[\s*\d+\s*\]/;
const AGG_SIG_AS_IF = /\(\s*if\s*\(\s*AGG_SIG_ME\b/i;
/** Real puzzle hashes — not `0x` + pubkey (x is a hex digit and caused false positives). */
const HEX64 = /(?:^|[^0-9a-fA-Fx])([0-9a-fA-F]{64})(?![0-9a-fA-F])/;
const DEADBEEF = /0xDEADBEEF/i;

/**
 * @param {{ path: string, content: string }[]} files
 * @param {{ requireHash?: boolean, resultText?: string }} [opts]
 * @returns {{ ok: boolean, failures: string[], warnings: string[] }}
 */
export function verifyWorkspaceFiles(files, opts = {}) {
  const failures = [];
  const warnings = [];
  const clspFiles = files.filter((f) => /\.clsp$/i.test(f.path));

  for (const f of clspFiles) {
    const body = String(f.content || "");
    const trimmed = body.trimStart();
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
  }

  if (clspFiles.length && opts.requireHash) {
    const corpus = [
      opts.resultText || "",
      ...files
        .filter((f) => /\.(md|ts|js|mjs)$/i.test(f.path))
        .map((f) => f.content),
    ].join("\n");
    const hasSection = /##\s*Pool puzzle hash/i.test(corpus);
    const hasHex = HEX64.test(corpus);
    if (!hasHex && !/cdv not (found|available)|chia-dev-tools/i.test(corpus)) {
      failures.push(
        "Wrote .clsp but no 64-char puzzle hash found in docs/result — run puzzle_hash tool (cdv) and document under ## Pool puzzle hash",
      );
    } else if (!hasSection && hasHex) {
      warnings.push(
        "Puzzle hash found but no ## Pool puzzle hash section — prefer documenting it in docs/MTT_POOL.md",
      );
    }
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
