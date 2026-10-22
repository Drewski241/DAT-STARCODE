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
/** Amplify/CloudFront reject large JSON bodies with empty 413 — stay under ~4MB. */
const PUSH_MAX_BYTES = Number(process.env.WORKSPACE_PUSH_MAX_BYTES || 3_500_000);

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
  return {
    job: data.job,
    github: data.github || null,
    githubClone: data.githubClone || null,
  };
}

async function workspacePost(job, action, files) {
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

function payloadBytes(job, action, files) {
  return Buffer.byteLength(
    JSON.stringify({
      jobId: job.id,
      workerId: WORKER_ID,
      action,
      files,
    }),
    "utf8",
  );
}

/** Push workspace files in chunks so Amplify does not 413 the request. */
async function pushWorkspaceChunked(job, files) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    return workspacePost(job, "push", []);
  }

  let batch = [];
  let written = 0;
  let batches = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await workspacePost(job, "push", batch);
    written += Number(result.written || batch.length);
    batches += 1;
    batch = [];
  };

  for (const file of list) {
    const alone = payloadBytes(job, "push", [file]);
    if (alone > PUSH_MAX_BYTES) {
      console.warn(
        `[dat-starcoder-worker] skip oversized file ${file.path} (${alone} bytes payload)`,
      );
      continue;
    }
    const withFile = payloadBytes(job, "push", [...batch, file]);
    if (batch.length > 0 && withFile > PUSH_MAX_BYTES) {
      await flush();
    }
    batch.push(file);
  }
  await flush();
  console.log(
    `[dat-starcoder-worker] workspace push ok written≈${written} batches=${batches}`,
  );
  return { ok: true, written, batches };
}

async function workspaceAction(job, action, files) {
  if (action === "push") {
    return pushWorkspaceChunked(job, files);
  }
  return workspacePost(job, action, files);
}

async function complete(job, { result, error, githubBranch, githubPrUrl }) {
  // Files are already on S3 via chunked workspace push — omit them here so
  // complete does not hit the same Amplify body limit. Server still writes RESULT.md.
  const payload = {
    jobId: job.id,
    workerId: WORKER_ID,
    result,
    error,
    githubBranch: githubBranch || null,
    githubPrUrl: githubPrUrl || null,
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
      const claimed = await claim();
      const job = claimed?.job;
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }
      const github = claimed.github;
      const githubClone = claimed.githubClone;
      const model = job.modelResolved || OLLAMA_MODEL;
      const repoLabel = github?.repoFullName || githubClone?.fullName;
      console.log(
        `[dat-starcoder-worker] claimed ${job.id} model=${model}` +
          (job.projectId ? ` project=${job.projectId.slice(0, 8)}` : "") +
          (repoLabel
            ? ` github=${repoLabel}${github ? "" : " (commands)"}`
            : ""),
      );

      const { result, files, githubBranch, githubPrUrl } = await runAgentJob({
        job,
        ollamaUrl: OLLAMA_URL,
        model,
        github,
        githubClone,
        pullWorkspace: (j) => workspaceAction(j, "pull"),
        pushWorkspace: (j, f) => workspaceAction(j, "push", f),
        log: console.log,
      });

      await complete(job, { result, githubBranch, githubPrUrl });
      console.log(
        `[dat-starcoder-worker] completed ${job.id} files=${files.length}` +
          (githubPrUrl ? ` pr=${githubPrUrl}` : ""),
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
