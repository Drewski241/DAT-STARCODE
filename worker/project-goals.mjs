/**
 * Durable multi-turn project goals stored in checkpoint.json.
 * The checklist itself lives in checklist.mjs so follow-ups keep the summary.
 */
export { deriveProjectGoal } from "./checklist.mjs";

/**
 * @param {Record<string, unknown>|null|undefined} cp
 */
export function formatProjectGoalForPrompt(cp) {
  const g = cp?.projectGoal;
  if (!g || typeof g !== "object") return "";
  const goal = /** @type {Record<string, unknown>} */ (g);
  const lines = ["## Project goal (multi-turn — stay on this)"];
  if (goal.summary) lines.push(`- Summary: ${goal.summary}`);
  if (goal.doneWhen) lines.push(`- Done when: ${goal.doneWhen}`);
  if (goal.status) lines.push(`- Status: ${goal.status}`);
  if (Array.isArray(goal.checks) && goal.checks.length) {
    lines.push("- Checklist:");
    for (const check of goal.checks.slice(0, 6)) {
      const mark = check.status === "passed" ? "x" : " ";
      lines.push(`  - [${mark}] ${check.text}`);
    }
  }
  if (Array.isArray(goal.openQuestions) && goal.openQuestions.length) {
    lines.push(
      `- Open questions: ${goal.openQuestions.slice(0, 5).join(" · ")}`,
    );
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Prefer checkpoint-touched files when ranking continue context.
 * @param {string[]} paths
 * @param {string[]} filesTouched
 * @param {{ softCoding?: boolean }} [opts] softCoding demotes seeded .clsp / puzzles/
 */
export function rankContinueFiles(paths, filesTouched = [], opts = {}) {
  const touched = new Set(
    (filesTouched || []).map((p) => String(p).replace(/\\/g, "/")),
  );
  const softCoding = Boolean(opts.softCoding);
  const scored = paths.map((p, i) => {
    let score = 0;
    if (touched.has(p)) score += 100;
    if (/(^|\/)(package\.json|index\.html|PLAN\.md)$/i.test(p)) score += 40;
    if (/\.(tsx?|jsx?|mjs|css)$/i.test(p)) score += 10;
    if (/RESULT\.md$|README\.md$/i.test(p)) score -= 20;
    if (softCoding && (/\.clsp$/i.test(p) || /(^|\/)puzzles\//i.test(p))) {
      score -= 80;
    }
    return { p, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.p);
}
