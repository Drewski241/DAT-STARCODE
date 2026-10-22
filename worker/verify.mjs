/**
 * Lightweight post-job checks for niche deliverables (e.g. ChiaLisp).
 */

const COMMON_LISP_BAD =
  /\b(defparameter|defvar|mapcar|progn|setf|getf|loop\s+for)\b|\(let\*/i;
const INDEX_SYNTAX = /\w+\s*\[\s*\d+\s*\]/;
const AGG_SIG_AS_IF = /\(\s*if\s*\(\s*AGG_SIG_ME\b/i;

/**
 * @param {{ path: string, content: string }[]} files
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function verifyWorkspaceFiles(files) {
  const failures = [];
  for (const f of files) {
    if (!/\.clsp$/i.test(f.path)) continue;
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
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Detect when the user prompt asks for ChiaLisp / .clsp work.
 * @param {string} prompt
 */
export function wantsChialisp(prompt) {
  return /\b(\.clsp|chialisp|chia\s*lisp|clvm|pool\s*coin|mtt_pool)\b/i.test(
    String(prompt || ""),
  );
}
