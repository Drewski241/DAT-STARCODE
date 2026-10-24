import {
  appendJobEvent,
  claimNextJob,
  completeJob,
  markJobRunning,
} from "@/lib/store";
import { retrieveKnowledge } from "@/lib/knowledge/packs";
import { packsForProfile } from "@/lib/agent-profile";

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

  const emit = async (
    type: "status" | "tool" | "tool_result" | "log",
    message: string,
    data?: Record<string, unknown> | null,
  ) => {
    try {
      await appendJobEvent({
        jobId: job.id,
        workerId: INLINE_WORKER_ID,
        type,
        message,
        data,
      });
    } catch {
      /* job may have finished */
    }
  };

  await emit("status", "Demo worker started");
  await new Promise((r) => setTimeout(r, 400));
  await emit("tool", "retrieve_knowledge", { step: 1 });
  await new Promise((r) => setTimeout(r, 350));

  const packs = packsForProfile(job.agentProfile);
  const knowledge = retrieveKnowledge(job.prompt, { packs, limit: 2 });
  await emit("tool_result", `retrieve_knowledge: ${knowledge.length} chunks`, {
    ok: true,
    summary: knowledge.map((k) => k.id).join(", ") || "none",
  });

  const knowledgeBlock =
    knowledge.length === 0
      ? ""
      : [
          "## Retrieved knowledge (demo)",
          ...knowledge.map((k) => `### ${k.title}\n${k.text}`),
          "",
        ].join("\n");

  let result: string;

  if (job.kind === "plan") {
    await emit("log", "Drafting project checklist…");
    const steps = demoPlanSteps(job.prompt);
    const planJson = {
      title: demoTitle(job.prompt),
      steps,
    };
    result = [
      `# Project plan (demo worker)`,
      "",
      `Profile: ${job.agentProfile}`,
      `Model: ${job.modelRequested} → ${job.modelResolved}`,
      "",
      "## Checklist",
      ...steps.map((s, i) => `${i + 1}. **${s.title}** — ${s.prompt}`),
      "",
      knowledgeBlock,
      "<!--PLAN_JSON",
      JSON.stringify(planJson),
      "PLAN_JSON-->",
      "",
      "_Demo worker synthesized this plan. Connect a live Ollama worker for real planning._",
    ]
      .filter((line) => line !== "")
      .join("\n");
  } else {
    if (job.agentProfile === "chialisp") {
      await emit("tool", "clvm_verify", {
        mode: "brun",
        program: "(+ 1 (q . 3))",
      });
      await new Promise((r) => setTimeout(r, 300));
      await emit("tool_result", "clvm_verify: ok (demo)", {
        ok: true,
        summary: "5",
      });
    }
    await emit("log", "Writing draft answer…");
    result = [
      `# DAT STARCODER draft for job ${job.id.slice(0, 8)}`,
      "",
      `## Request`,
      job.prompt,
      "",
      job.repoHint ? `## Repo hint\n${job.repoHint}\n` : "",
      `## Model`,
      `${job.modelRequested} → ${job.modelResolved} (${job.modelReason})`,
      `Profile: ${job.agentProfile} · kind: ${job.kind}`,
      "",
      knowledgeBlock,
      `## Plan`,
      "1. Clarify acceptance criteria from the prompt.",
      "2. Use tools (web_search / fetch_url / read_file / clvm_verify) when needed.",
      "3. Implement the smallest change with tests where practical.",
      "4. Summarize diffs, commands run, and residual risks.",
      "",
      `## Notes`,
      "This result was produced by the **demo worker** (simulated tool stream).",
      "Connect a live worker (`npm run worker`) for Ollama + real tools.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  await emit("status", "Completing job");
  return completeJob({
    jobId: job.id,
    workerId: INLINE_WORKER_ID,
    result,
    toolSteps: job.agentProfile === "chialisp" ? 2 : 1,
  });
}

function demoTitle(prompt: string) {
  const goal = prompt.replace(/^[\s\S]*Goal:\n?/i, "").trim();
  const line = (goal || prompt).split("\n").find((l) => l.trim()) || "Project";
  return line.trim().slice(0, 72);
}

function demoPlanSteps(prompt: string) {
  const goal = prompt.replace(/^[\s\S]*Goal:\n?/i, "").trim() || prompt;
  const short = goal.split("\n")[0].slice(0, 100);
  return [
    {
      title: "Clarify scope & acceptance checks",
      prompt: `Restate the goal and list 3 acceptance checks for: ${short}`,
    },
    {
      title: "Research & gather references",
      prompt: `Search docs/web as needed and note the key APIs or commands for: ${short}`,
    },
    {
      title: "Implement the core change",
      prompt: `Make the smallest concrete change that advances: ${short}. Show patches or commands.`,
    },
    {
      title: "Verify and summarize",
      prompt: `Describe how to verify the work for: ${short}. List residual risks and follow-ups.`,
    },
  ];
}
