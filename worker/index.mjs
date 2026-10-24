#!/usr/bin/env node
/**
 * DAT STARCODER worker — run on the machine that hosts the coding GPU.
 *
 * Env:
 *   DAT_STARCODER_API_BASE   (or ANVIL_API_BASE)  https://your-app.example.com
 *   WORKER_API_KEY           must match server WORKER_API_KEY
 *   WORKER_ID                unique name for this box (default: forge-1)
 *   OLLAMA_URL               http://127.0.0.1:11434
 *   OLLAMA_MODEL             fallback if a job has no modelResolved
 *   POLL_MS                  default 4000
 *   AGENT_MAX_STEPS          max tool iterations (default 8)
 *   AGENT_REPO_ROOT          sandbox root for file tools (default cwd)
 *   AGENT_ALLOW_SHELL        set 1 to enable allowlisted run_command
 */

import { runAgentJob } from "./agent.mjs";

const API_BASE = (
  process.env.DAT_STARCODER_API_BASE ||
  process.env.ANVIL_API_BASE ||
  "http://127.0.0.1:43127"
).replace(/\/$/, "");
const WORKER_KEY = process.env.WORKER_API_KEY || "dev-worker-key-change-me";
const WORKER_ID = process.env.WORKER_ID || "forge-1";
const POLL_MS = Number(process.env.POLL_MS || 4000);

async function claim() {
  const res = await fetch(`${API_BASE}/api/worker/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-key": WORKER_KEY,
    },
    body: JSON.stringify({ workerId: WORKER_ID }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`claim ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.job;
}

async function complete(jobId, { result, error, toolSteps }) {
  const res = await fetch(`${API_BASE}/api/worker/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-key": WORKER_KEY,
    },
    body: JSON.stringify({
      jobId,
      workerId: WORKER_ID,
      result,
      error,
      toolSteps,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`complete ${res.status}: ${text}`);
  }
  return res.json();
}

async function loop() {
  console.log(`[dat-starcoder-worker] ${WORKER_ID} → ${API_BASE}`);
  console.log(
    `[dat-starcoder-worker] agent tools on · max_steps=${process.env.AGENT_MAX_STEPS || 8} shell=${process.env.AGENT_ALLOW_SHELL === "1" ? "allowlist" : "off"}`,
  );
  for (;;) {
    try {
      const job = await claim();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      const model = job.modelResolved || process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
      console.log(
        `[dat-starcoder-worker] claimed ${job.id} kind=${job.kind || "task"} profile=${job.agentProfile || "?"} model=${model}`,
      );
      const { result, toolSteps } = await runAgentJob(job);
      await complete(job.id, { result, toolSteps });
      console.log(
        `[dat-starcoder-worker] completed ${job.id} toolSteps=${toolSteps}`,
      );
    } catch (err) {
      console.error("[dat-starcoder-worker]", err);
      await sleep(POLL_MS);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

loop();
