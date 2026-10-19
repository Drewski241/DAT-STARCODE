import { claimNextJob, completeJob, markJobRunning } from "@/lib/store";

const INLINE_WORKER_ID = "inline-dev-worker";

/**
 * When no live worker is connected, process queued jobs inside the
 * Next.js process with a deterministic coding-agent stub so the studio
 * UI is usable in local/demo mode.
 */
export async function processOneInlineJob() {
  if (process.env.DISABLE_INLINE_WORKER === "1") return null;

  const job = await claimNextJob(INLINE_WORKER_ID);
  if (!job) return null;
  await markJobRunning(job.id, INLINE_WORKER_ID);

  await new Promise((r) => setTimeout(r, 900));

  const result = [
    `# DAT STARCODER draft for job ${job.id.slice(0, 8)}`,
    "",
    `## Request`,
    job.prompt,
    "",
    job.repoHint ? `## Repo hint\n${job.repoHint}\n` : "",
    `## Plan`,
    "1. Clarify acceptance criteria from the prompt.",
    "2. Locate the smallest set of files to change.",
    "3. Implement the change with tests where practical.",
    "4. Summarize diffs and residual risks.",
    "",
    `## Notes`,
    "This result was produced by the **demo worker**.",
    "Connect a live worker to run full model inference for production jobs.",
  ]
    .filter(Boolean)
    .join("\n");

  return completeJob({
    jobId: job.id,
    workerId: INLINE_WORKER_ID,
    result,
  });
}
