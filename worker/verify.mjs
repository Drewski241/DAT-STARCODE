/**
 * Lightweight post-job checks for niche deliverables (e.g. ChiaLisp).
 */

const COMMON_LISP_BAD =
  /\b(defparameter|defvar|mapcar|progn|setf|getf|loop\s+for)\b|\(let\*/i;
const INDEX_SYNTAX = /\w+\s*\[\s*\d+\s*\]/;
const AGG_SIG_AS_IF = /\(\s*if\s*\(\s*AGG_SIG_ME\b/i;
const DEADBEEF = /0xDEADBEEF/i;

/**
 * Extract a bare 64-char hex puzzle hash from a ## Pool puzzle hash section.
 * Rejects `0x…` placeholders (x is a hex digit so naive {64} matches lie).
 */
export function findBarePuzzleHash(text) {
  const s = String(text || "");
  const section = s.match(/##\s*Pool puzzle hash\s*\n([\s\S]{0,500})/i);
  if (!section) return null;
  const chunk = section[1].split(/\n##\s+/)[0] || "";
  // Strip 0x-prefixed tokens so they cannot satisfy the bare-hash check.
  const scrubbed = chunk.replace(/0x[0-9a-fA-F]+/gi, "OX_STRIPPED");
  const m = scrubbed.match(/(^|[^0-9a-fA-F])([0-9a-fA-F]{64})([^0-9a-fA-F]|$)/);
  return m ? m[2].toLowerCase() : null;
}

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
    const docs = files
      .filter((f) => /\.md$/i.test(f.path))
      .map((f) => f.content)
      .join("\n");
    const corpus = [opts.resultText || "", docs].join("\n");
    const hasSection = /##\s*Pool puzzle hash/i.test(corpus);
    const bareHash = findBarePuzzleHash(corpus);
    const cdvMissingNoted = /cdv not (found|available)|chia-dev-tools/i.test(
      corpus,
    );
    if (!hasSection) {
      failures.push(
        "Wrote .clsp but missing ## Pool puzzle hash section — run puzzle_hash tool and document the bare hex",
      );
    } else if (!bareHash && !cdvMissingNoted) {
      failures.push(
        "## Pool puzzle hash must contain a bare 64-char hex from puzzle_hash/cdv (no 0x prefix / no placeholders)",
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
