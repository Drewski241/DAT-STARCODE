/**
 * Enforce PLAN.md before multi-file coding work on hard goals.
 */

const PLAN_REL = "PLAN.md";

/**
 * @param {string} text
 */
export function planLooksComplete(text) {
  const t = String(text || "");
  const hasGoal = /\bgoal\b/i.test(t);
  const hasDone = /\bdone\s*when\b/i.test(t);
  const hasFiles = /\bfiles?\b/i.test(t);
  return hasGoal && hasDone && hasFiles && t.trim().length >= 40;
}

/**
 * @param {string} root
 * @param {(rel: string) => Promise<string>} readFile
 */
export async function readPlan(root, readFile) {
  try {
    return await readFile(PLAN_REL);
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   hard: boolean,
 *   wantCdv: boolean,
 *   goalId: string,
 *   resultOnly?: boolean,
 *   planPresent: boolean,
 *   planComplete: boolean,
 *   tool: string,
 *   path?: string,
 * }} ctx
 */
export function shouldBlockEditWithoutPlan(ctx) {
  if (ctx.resultOnly) return false;
  // ChiaLisp / treasury already have domain playbooks; still want a plan on hard coding.
  if (!ctx.hard && ctx.goalId !== "coding") return false;
  if (!ctx.hard) return false;
  const tool = String(ctx.tool || "");
  if (tool !== "write_file" && tool !== "str_replace") return false;
  const p = String(ctx.path || "").replace(/\\/g, "/");
  if (!p) return false;
  if (/(^|\/)PLAN\.md$/i.test(p)) return false;
  if (ctx.planPresent && ctx.planComplete) return false;
  return true;
}

/**
 * @param {{ planPresent: boolean, planComplete: boolean }} state
 */
export function planGateMessage(state) {
  if (!state.planPresent) {
    return (
      "POLICY: hard coding turns require PLAN.md first. " +
      'write_file PLAN.md with sections Goal / Done when / Files (ordered paths), then continue edits.'
    );
  }
  return (
    "POLICY: PLAN.md is incomplete — include Goal, Done when, and Files sections (≥40 chars), then continue."
  );
}

/**
 * Reject done until plan exists on hard coding (when steps remain).
 */
export function shouldRejectDoneWithoutPlan(ctx) {
  if (ctx.resultOnly || !ctx.hard) return false;
  if (ctx.goalId === "general") return false;
  return !ctx.planPresent || !ctx.planComplete;
}
