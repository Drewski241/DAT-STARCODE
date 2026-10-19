#!/usr/bin/env node
/**
 * Anvil P720 worker — run on the ThinkStation next to the RTX 3090.
 *
 * Env:
 *   ANVIL_API_BASE   https://your-amplify-app.amplifyapp.com
 *   WORKER_API_KEY   must match AWS / .env WORKER_API_KEY
 *   WORKER_ID        unique name for this box (default: p720)
 *   OLLAMA_URL       http://127.0.0.1:11434 (optional)
 *   OLLAMA_MODEL     e.g. qwen2.5-coder:14b
 *   POLL_MS          default 4000
 */

const API_BASE = (process.env.ANVIL_API_BASE || "http://127.0.0.1:43127").replace(
  /\/$/,
  "",
);
const WORKER_KEY = process.env.WORKER_API_KEY || "dev-worker-key-change-me";
const WORKER_ID = process.env.WORKER_ID || "p720";
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

async function runWithOllama(job) {
  const prompt = [
    "You are Anvil, a careful coding agent running on a local RTX GPU.",
    "Return a concrete implementation plan and code patches in markdown.",
    job.repoHint ? `Repo/path hint: ${job.repoHint}` : "",
    "",
    "User request:",
    job.prompt,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama ${res.status}`);
    }
    const data = await res.json();
    return data.response || "(empty Ollama response)";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return [
      `# Offline fallback (Ollama unreachable: ${reason})`,
      "",
      `Model target: ${OLLAMA_MODEL}`,
      "",
      "## Request",
      job.prompt,
      "",
      "## Suggested next step on the P720",
      "1. Install Ollama and pull a coder model that fits 24GB VRAM (or quantized for tighter budgets).",
      `2. ` + "`ollama pull " + OLLAMA_MODEL + "`",
      "3. Restart this worker with OLLAMA_URL pointing at the local daemon.",
    ].join("\n");
  }
}

async function loop() {
  console.log(`[anvil-worker] ${WORKER_ID} → ${API_BASE}`);
  for (;;) {
    try {
      const job = await claim();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      console.log(`[anvil-worker] claimed ${job.id}`);
      const result = await runWithOllama(job);
      await complete(job.id, { result });
      console.log(`[anvil-worker] completed ${job.id}`);
    } catch (err) {
      console.error("[anvil-worker]", err);
      await sleep(POLL_MS);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

loop();
