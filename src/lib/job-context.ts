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
    let resultText = parent.result;
    // Drop ChiaLisp verification footers from soft coding continuations so
    // the model doesn't chase .clsp on a screenshot / HTML follow-up.
    if (
      !/\b(\.clsp|chialisp|clvm|treasury|mtt_pool)\b/i.test(parent.prompt || "")
    ) {
      resultText = resultText
        .replace(/\n## Verification failed[\s\S]*$/i, "")
        .replace(/\n## Puzzle hash[\s\S]*$/i, "")
        .replace(/\n## Spend fixtures[\s\S]*$/i, "");
    }
    const clipped =
      resultText.length > 8_000
        ? `${resultText.slice(0, 8_000)}\n…(truncated)`
        : resultText;
    parts.push("### Prior agent result", clipped, "");
  }

  const files = await listWorkspaceFiles(parent);
  const checkpoint = await readWorkspaceFile(
    parent,
    ".datstarcoder/checkpoint.json",
  );
  let filesTouched: string[] = [];
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
    try {
      const parsed = JSON.parse(checkpoint) as {
        filesTouched?: string[];
        projectGoal?: { summary?: string; doneWhen?: string };
      };
      if (Array.isArray(parsed.filesTouched)) {
        filesTouched = parsed.filesTouched.map(String);
      }
      if (parsed.projectGoal?.summary) {
        parts.push(
          "### Durable project goal",
          `- Summary: ${parsed.projectGoal.summary}`,
          parsed.projectGoal.doneWhen
            ? `- Done when: ${parsed.projectGoal.doneWhen}`
            : "",
          "",
        );
      }
    } catch {
      /* ignore bad checkpoint json */
    }
  }

  const promptLooksChia =
    /\b(\.clsp|chialisp|clvm|treasury|mtt_pool|puzzle\s*hash)\b/i.test(
      parent.prompt || "",
    );

  const ranked = files
    .map((f) => f.path)
    .filter(
      (p) =>
        !p.endsWith("README.md") &&
        !p.endsWith("job.json") &&
        p !== "RESULT.md",
    )
    .map((p, i) => {
      let score = 0;
      if (filesTouched.includes(p)) score += 100;
      if (/(^|\/)(package\.json|index\.html|PLAN\.md)$/i.test(p)) score += 40;
      if (/\.(tsx?|jsx?|mjs|css)$/i.test(p)) score += 10;
      if (/RESULT\.md$/i.test(p)) score -= 20;
      // Seeded puzzle templates poison soft coding follow-ups — demote unless
      // the prior turn was already ChiaLisp / treasury work.
      if (/\.clsp$/i.test(p) || /(^|\/)puzzles\//i.test(p)) {
        score += promptLooksChia ? 20 : -80;
      }
      return { p, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.p);

  const codeFiles = ranked.slice(0, MAX_FILES);

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
