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
 */

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
    const text = await res.text();
    throw new Error(`claim ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.job;
}

async function complete(jobId, { result, error }) {
  const res = await fetch(`${API_BASE}/api/worker/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-key": WORKER_KEY,
    },
    body: JSON.stringify({ jobId, workerId: WORKER_ID, result, error }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`complete ${res.status}: ${text}`);
  }
  return res.json();
}

function systemPromptFor(job, model) {
  const coding = /coder/i.test(model);
  if (coding) {
    return [
      "You are DAT STARCODER, a careful coding agent.",
      "Return a concrete implementation plan and code patches in markdown.",
      job.repoHint ? `Repo/path hint: ${job.repoHint}` : "",
      "",
      "User request:",
      job.prompt,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "You are DAT STARCODER, a helpful assistant.",
    "Answer clearly and accurately. Use markdown when useful.",
    "",
    "User request:",
    job.prompt,
  ].join("\n");
}

async function runWithOllama(job) {
  const model = job.modelResolved || OLLAMA_MODEL;
  const prompt = systemPromptFor(job, model);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const header = [
      `Model: ${job.modelRequested || "auto"} → ${model}`,
      job.modelReason ? `Reason: ${job.modelReason}` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");
    return `${header}${data.response || "(empty Ollama response)"}`;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return [
      `# Offline fallback (Ollama unreachable: ${reason})`,
      "",
      `Model target: ${model}`,
      "",
      "## Request",
      job.prompt,
      "",
      "## Suggested next step",
      `1. ollama pull ${model}`,
      "2. Confirm Ollama is running on OLLAMA_URL.",
      "3. Restart this worker.",
    ].join("\n");
  }
}

async function loop() {
  console.log(`[dat-starcoder-worker] ${WORKER_ID} → ${API_BASE}`);
  for (;;) {
    try {
      const job = await claim();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      const model = job.modelResolved || OLLAMA_MODEL;
      console.log(
        `[dat-starcoder-worker] claimed ${job.id} model=${model}`,
      );
      const result = await runWithOllama(job);
      await complete(job.id, { result });
      console.log(`[dat-starcoder-worker] completed ${job.id}`);
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
