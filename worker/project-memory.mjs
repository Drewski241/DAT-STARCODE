/**
 * Per-workspace checkpoint so follow-up turns remember failures and edits.
 * Path: .datstarcoder/checkpoint.json
 */
import { promises as fs } from "fs";
import path from "path";

export const CHECKPOINT_REL = ".datstarcoder/checkpoint.json";

/**
 * @param {string} root
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function loadCheckpoint(root) {
  try {
    const raw = await fs.readFile(path.join(root, CHECKPOINT_REL), "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} root
 * @param {Record<string, unknown>} patch
 */
export async function saveCheckpoint(root, patch) {
  const prev = (await loadCheckpoint(root)) || {};
  const next = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const dir = path.join(root, ".datstarcoder");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(root, CHECKPOINT_REL),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
  return next;
}

/**
 * @param {Record<string, unknown>|null|undefined} cp
 */
export function formatCheckpointForPrompt(cp) {
  if (!cp || typeof cp !== "object") return "";
  const lines = ["## Project checkpoint (do not ignore)"];
  if (cp.goal) lines.push(`- Goal: ${cp.goal}`);
  if (cp.projectGoal && typeof cp.projectGoal === "object") {
    const g = /** @type {Record<string, unknown>} */ (cp.projectGoal);
    if (g.summary) lines.push(`- Project summary: ${g.summary}`);
    if (g.doneWhen) lines.push(`- Done when: ${g.doneWhen}`);
    if (g.status) lines.push(`- Project status: ${g.status}`);
  }
  if (cp.lastCommand) lines.push(`- Last command: \`${cp.lastCommand}\``);
  if (cp.lastErrorKind) lines.push(`- Last error class: ${cp.lastErrorKind}`);
  if (cp.lastErrorSnippet) {
    lines.push(
      `- Last error snippet:\n\`\`\`\n${String(cp.lastErrorSnippet).slice(0, 1200)}\n\`\`\``,
    );
  }
  if (Array.isArray(cp.filesTouched) && cp.filesTouched.length) {
    lines.push(`- Files touched: ${cp.filesTouched.slice(0, 20).join(", ")}`);
  }
  if (Array.isArray(cp.preservePaths) && cp.preservePaths.length) {
    lines.push(
      `- Preserve (do not overwrite from templates): ${cp.preservePaths.join(", ")}`,
    );
  }
  if (cp.previewPath) lines.push(`- Preview entry: ${cp.previewPath}`);
  if (cp.notes) lines.push(`- Notes: ${cp.notes}`);
  if (Array.isArray(cp.decisions) && cp.decisions.length) {
    lines.push(
      `- Decisions: ${cp.decisions
        .slice(-8)
        .map((d) => String(d))
        .join(" · ")}`,
    );
  }
  if (Array.isArray(cp.neverDo) && cp.neverDo.length) {
    lines.push(
      `- Never do: ${cp.neverDo
        .slice(-8)
        .map((d) => String(d))
        .join(" · ")}`,
    );
  }
  if (Array.isArray(cp.openBugs) && cp.openBugs.length) {
    lines.push(
      `- Open bugs: ${cp.openBugs
        .slice(-8)
        .map((d) => String(d))
        .join(" · ")}`,
    );
  }
  if (cp.verifyStatus) lines.push(`- Last verify: ${cp.verifyStatus}`);
  if (
    typeof cp.verifyFailStreak === "number" &&
    cp.verifyFailStreak > 0
  ) {
    lines.push(`- Verify fail streak: ${cp.verifyFailStreak}`);
    if (cp.verifyFailStreak >= 2) {
      lines.push(
        "- VERIFY_FAIL_STREAK: 2+ — prefer stronger model / smaller diffs",
      );
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * Merge long-horizon memory fields without wiping history.
 * @param {Record<string, unknown>|null|undefined} prev
 * @param {Record<string, unknown>} patch
 */
export function mergeLongHorizon(prev, patch) {
  const base = prev && typeof prev === "object" ? { ...prev } : {};
  const next = { ...base, ...patch };
  for (const key of ["decisions", "neverDo", "openBugs"]) {
    const a = Array.isArray(base[key]) ? base[key] : [];
    const b = Array.isArray(patch[key]) ? patch[key] : [];
    if (a.length || b.length) {
      next[key] = [...new Set([...a, ...b].map((x) => String(x)))].slice(-24);
    }
  }
  return next;
}
