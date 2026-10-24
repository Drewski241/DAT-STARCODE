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
 *   AGENT_MAX_STEPS          default 12
 */

import { runAgentJob } from "./agent.mjs";

const API_BASE = (
  process.env.DAT_STARCODER_API_BASE ||
  process.env.ANVIL_API_BASE ||
  "http://127.0.0.1:43127"
).replace(/\/$/, "");
const WORKER_KEY = process.env.WORKER_API_KEY || "dev-worker-key-change-me";
const WORKER_ID = process.env.WORKER_ID || "forge-1";
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(
  /\/$/,
  "",
);
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
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
    const text = (await res.text()).trim();
    throw new Error(
      `claim ${res.status}: ${text || "(empty body — check Amplify logs)"}`,
    );
  }
  const data = await res.json();
  return data.job;
}

async function workspaceAction(job, action, files) {
  const res = await fetch(`${API_BASE}/api/worker/workspace`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-key": WORKER_KEY,
    },
    body: JSON.stringify({
      jobId: job.id,
      workerId: WORKER_ID,
      action,
      files,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`workspace ${action} ${res.status}: ${text}`);
  }
  return res.json();
}

async function progress(jobId, { type, message, data }) {
  try {
    await fetch(`${API_BASE}/api/worker/progress`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-key": WORKER_KEY,
      },
      body: JSON.stringify({
        jobId,
        workerId: WORKER_ID,
        type,
        message,
        data: data ?? null,
      }),
    });
  } catch (err) {
    console.warn("[dat-starcoder-worker] progress failed", err);
  }
}

async function complete(job, { result, error, files, toolSteps }) {
  const payload = {
    jobId: job.id,
    workerId: WORKER_ID,
    result,
    error,
    files,
    toolSteps,
    snapshot: job,
  };
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API_BASE}/api/worker/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-key": WORKER_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    lastErr = new Error(`complete ${res.status}: ${text}`);
    if (res.status === 401) throw lastErr;
    await sleep(500 * (attempt + 1));
  }
  throw lastErr;
}

async function loop() {
  console.log(`[dat-starcoder-worker] ${WORKER_ID} → ${API_BASE} (agent loop)`);
  for (;;) {
    try {
      const job = await claim();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      const model = job.modelResolved || OLLAMA_MODEL;
      console.log(
        `[dat-starcoder-worker] claimed ${job.id} model=${model}` +
          (job.projectId ? ` project=${job.projectId.slice(0, 8)}` : ""),
      );

      const { result, files, toolSteps } = await runAgentJob({
        job,
        ollamaUrl: OLLAMA_URL,
        model,
        pullWorkspace: (j) => workspaceAction(j, "pull"),
        pushWorkspace: (j, f) => workspaceAction(j, "push", f),
        log: console.log,
        onEvent: (e) =>
          progress(job.id, {
            type: e.type,
            message: e.message,
            data: e.data,
          }),
      });

      await complete(job, { result, files, toolSteps });
      console.log(
        `[dat-starcoder-worker] completed ${job.id} files=${files.length} tools=${toolSteps}`,
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
