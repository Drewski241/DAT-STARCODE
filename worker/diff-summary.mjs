/**
 * Build a UTF-8 diff summary between pulled Studio files and final workspace.
 */
import { createHash } from "crypto";

/**
 * @param {{ path: string, content: string }[]} before
 * @param {{ path: string, content: string }[]} after
 */
export function summarizeWorkspaceDiff(before, after) {
  const bMap = new Map(
    (before || []).map((f) => [normalize(f.path), String(f.content ?? "")]),
  );
  const aMap = new Map(
    (after || []).map((f) => [normalize(f.path), String(f.content ?? "")]),
  );

  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const removed = [];
  /** @type {{ path: string, beforeLines: number, afterLines: number, hashBefore: string, hashAfter: string }[]} */
  const changed = [];

  for (const [p, content] of aMap) {
    if (!bMap.has(p)) {
      added.push(p);
      continue;
    }
    const prev = bMap.get(p) || "";
    if (prev !== content) {
      changed.push({
        path: p,
        beforeLines: lineCount(prev),
        afterLines: lineCount(content),
        hashBefore: shortHash(prev),
        hashAfter: shortHash(content),
      });
    }
  }
  for (const p of bMap.keys()) {
    if (!aMap.has(p)) removed.push(p);
  }

  added.sort();
  removed.sort();
  changed.sort((a, b) => a.path.localeCompare(b.path));

  const unifiedSnippets = changed.slice(0, 12).map((c) => {
    const prev = bMap.get(c.path) || "";
    const next = aMap.get(c.path) || "";
    return {
      path: c.path,
      patch: makeTinyPatch(prev, next),
    };
  });

  return {
    added,
    removed,
    changed: changed.map((c) => c.path),
    details: changed,
    snippets: unifiedSnippets,
    summary: `${added.length} added · ${changed.length} changed · ${removed.length} removed`,
  };
}

/**
 * @param {ReturnType<typeof summarizeWorkspaceDiff>} diff
 */
export function formatDiffForPrompt(diff) {
  if (!diff) return "";
  const lines = [
    "## Workspace diff this turn",
    diff.summary,
  ];
  if (diff.added.length) {
    lines.push(`- Added: ${diff.added.slice(0, 20).join(", ")}`);
  }
  if (diff.changed.length) {
    lines.push(`- Changed: ${diff.changed.slice(0, 20).join(", ")}`);
  }
  if (diff.removed.length) {
    lines.push(`- Removed: ${diff.removed.slice(0, 20).join(", ")}`);
  }
  return lines.join("\n");
}

function normalize(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function lineCount(s) {
  if (!s) return 0;
  return s.split(/\r?\n/).length;
}

function shortHash(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

/**
 * Very small line-oriented patch for Studio (not a full unified diff).
 * @param {string} before
 * @param {string} after
 */
function makeTinyPatch(before, after) {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  /** @type {string[]} */
  const out = [];
  const max = Math.max(a.length, b.length);
  let shown = 0;
  for (let i = 0; i < max && shown < 40; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (left != null) {
      out.push(`- ${left}`);
      shown++;
    }
    if (right != null) {
      out.push(`+ ${right}`);
      shown++;
    }
  }
  if (!out.length) return "(no line-level snippet)";
  if (shown >= 40) out.push("…");
  return out.join("\n");
}
