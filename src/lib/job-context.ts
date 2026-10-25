import { getJob } from "@/lib/store";
import { listWorkspaceFiles, readWorkspaceFile } from "@/lib/workspace";
import type { CodingJob } from "@/lib/types";

const MAX_CONTEXT_CHARS = 24_000;
const MAX_FILE_CHARS = 6_000;
const MAX_FILES = 8;

/**
 * Build follow-up context from a prior completed job so the worker knows
 * what was just built (prompt, result summary, and key workspace files).
 */
export async function buildContinueContext(
  parentJobId: string,
  accountId: string,
): Promise<{ parent: CodingJob; context: string } | null> {
  const parent = await getJob(parentJobId);
  if (!parent || parent.accountId !== accountId) return null;
  if (parent.status !== "completed") return null;

  const parts: string[] = [
    "## Prior job context",
    `Job: ${parent.id}`,
    "",
    "### Prior user request",
    parent.prompt,
    "",
  ];

  if (parent.result) {
    const clipped =
      parent.result.length > 8_000
        ? `${parent.result.slice(0, 8_000)}\n…(truncated)`
        : parent.result;
    parts.push("### Prior agent result", clipped, "");
  }

  const files = await listWorkspaceFiles(parent);
  const codeFiles = files
    .map((f) => f.path)
    .filter(
      (p) =>
        !p.endsWith("README.md") &&
        !p.endsWith("job.json") &&
        p !== "RESULT.md",
    )
    .slice(0, MAX_FILES);

  const checkpoint = await readWorkspaceFile(
    parent,
    ".datstarcoder/checkpoint.json",
  );
  if (checkpoint) {
    parts.push(
      "### Project checkpoint",
      "```json",
      checkpoint.length > 4_000
        ? `${checkpoint.slice(0, 4_000)}\n…(truncated)`
        : checkpoint,
      "```",
      "",
    );
  }

  if (codeFiles.length > 0) {
    parts.push("### Prior workspace files (continue from these)");
    for (const rel of codeFiles) {
      const content = await readWorkspaceFile(parent, rel);
      if (content == null) continue;
      const body =
        content.length > MAX_FILE_CHARS
          ? `${content.slice(0, MAX_FILE_CHARS)}\n…(truncated)`
          : content;
      parts.push(`#### File: ${rel}`, "```", body, "```", "");
    }
  }

  let context = parts.join("\n").trim();
  if (context.length > MAX_CONTEXT_CHARS) {
    context = `${context.slice(0, MAX_CONTEXT_CHARS)}\n…(truncated)`;
  }

  return { parent, context };
}
