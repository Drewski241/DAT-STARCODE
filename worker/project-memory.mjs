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
  return lines.length > 1 ? lines.join("\n") : "";
}
