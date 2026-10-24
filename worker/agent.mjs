/**
 * Tool-using agent loop for DAT STARCODER worker.
 * Operates on a local workspace synced from/to the API.
 */
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import os from "os";
import { clvmVerify } from "./clvm-verify.mjs";
import { retrieveKnowledge, packsForProfile } from "./knowledge.mjs";

const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 12);
const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS || 20000);
const MAX_FILE_BYTES = 200_000;

const HOW_TO_RUN = `
Always end your final answer with a section titled exactly: ## How to run / play
Write numbered steps for a non-technical user. Include: download zip from Studio
Workspace (if needed), unzip, which file to open or command to run, controls/usage,
and common fixes. Never stop at only "download the zip".
`.trim();

const UNBIASED_QNA = `
For everyday questions: be accurate and unbiased, separate facts from contested opinions,
and say when unsure. Use web_search for time-sensitive facts. Never ask for passwords or
recovery keys. Medical/legal/financial topics = general info only + suggest professionals when stakes are high.
`.trim();

function safeRel(p) {
  const n = String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  if (!n || n.includes("..") || n.startsWith("/")) return null;
  if (!/^[A-Za-z0-9_./@+-]+$/.test(n)) return null;
  return n;
}

async function listTree(root, dir = root, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      await listTree(root, full, out);
    } else if (e.isFile()) {
      out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  }
  return out.sort();
}

async function toolList(root) {
  const files = await listTree(root);
  return files.length ? files.join("\n") : "(empty workspace)";
}

async function toolRead(root, rel) {
  const safe = safeRel(rel);
  if (!safe) return "ERROR: invalid path";
  const full = path.join(root, safe);
  try {
    const buf = await fs.readFile(full);
    if (buf.length > MAX_FILE_BYTES) {
      return `ERROR: file too large (${buf.length} bytes)`;
    }
    return buf.toString("utf8");
  } catch {
    return `ERROR: cannot read ${safe}`;
  }
}

async function toolWrite(root, rel, content) {
  const safe = safeRel(rel);
  if (!safe) return "ERROR: invalid path";
  const full = path.join(root, safe);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const text = String(content ?? "");
  if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) {
    return "ERROR: content too large";
  }
  await fs.writeFile(full, text, "utf8");
  return `OK wrote ${safe} (${Buffer.byteLength(text, "utf8")} bytes)`;
}

function runCommand(root, command) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: root,
      shell: true,
      env: {
        ...process.env,
        PATH: process.env.PATH,
        HOME: process.env.HOME,
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(
        `ERROR: timed out after ${RUN_TIMEOUT_MS}ms\n${stdout}\n${stderr}`.slice(
          0,
          8000,
        ),
      );
    }, RUN_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(
        `exit ${code}\n${stdout}${stderr ? `\nSTDERR:\n${stderr}` : ""}`.slice(
          0,
          8000,
        ),
      );
    });
  });
}

function parseAction(text) {
  const raw = String(text || "").trim();
  // Prefer fenced json
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : raw;
  // Find first JSON object
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  // DONE: message
  const done = raw.match(/^DONE:\s*([\s\S]+)/i);
  if (done) return { done: true, message: done[1].trim() };
  return null;
}

function detectProfile(prompt) {
  if (/\b(chialisp|clvm|chia\b|coinset|curry|agg_sig|create_coin)\b/i.test(prompt))
    return "chialisp";
  if (
    /\b(windows|macos|mac\b|chromebook|chromeos|ubuntu|linux|how do i|wifi|settings)\b/i.test(
      prompt,
    )
  )
    return "ops";
  if (
    /\b(code|bug|fix|implement|typescript|python|game|app|website|build)\b/i.test(
      prompt,
    )
  )
    return "coding";
  return "general";
}

function agentSystem(job) {
  const profile = detectProfile(job.prompt || "");
  const packs = packsForProfile(profile);
  const chunks = retrieveKnowledge(job.prompt || "", { packs, limit: 3 });
  const knowledge =
    chunks.length === 0
      ? ""
      : [
          "Retrieved knowledge:",
          ...chunks.map((c) => `### ${c.title}\n${c.text}`),
        ].join("\n\n");

  return [
    "You are DAT STARCODER, a robust coding and help agent with tools.",
    "You work inside a real project workspace on disk when coding.",
    "You also help with Windows / macOS / ChromeOS / Linux how-tos and everyday questions.",
    UNBIASED_QNA,
    profile === "chialisp"
      ? "For ChiaLisp/CLVM, prefer clvm_verify (brun/run) before finishing."
      : "",
    "On every turn respond with ONLY one JSON object (optionally in a ```json fence):",
    "",
    '1) Call a tool: {"thought":"...","tool":"list_files"|"read_file"|"write_file"|"run"|"web_search"|"fetch_url"|"clvm_verify","args":{...}}',
    '   - list_files args: {}',
    '   - read_file args: {"path":"relative/path"}',
    '   - write_file args: {"path":"relative/path","content":"full file contents"}',
    '   - run args: {"command":"shell command in the workspace"}',
    '   - web_search args: {"query":"..."}',
    '   - fetch_url args: {"url":"https://..."}',
    '   - clvm_verify args: {"program":"...","solution":"()","mode":"brun"|"run","expect":"optional"}',
    "",
    '2) Finish: {"done":true,"message":"markdown answer for the user"}',
    "",
    "Rules:",
    "- Explore with list_files/read_file before editing when files may already exist.",
    "- Prefer small, working changes. Write complete files when creating them.",
    "- Use run to install/build/test when helpful (keep commands short).",
    "- Use web_search when facts may be stale (OS menus, docs, current APIs).",
    "- For games/apps, make something runnable (often index.html).",
    HOW_TO_RUN,
    knowledge,
    job.projectId ? `Project id: ${job.projectId}` : "",
    job.context ? `\nPrior context:\n${job.context}\n` : "",
    "",
    "User request:",
    job.prompt,
  ]
    .filter(Boolean)
    .join("\n");
}

async function webSearch(query) {
  const q = String(query || "").trim();
  if (!q) return "ERROR: query required";
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
      {
        headers: { "User-Agent": "DAT-STARCODER-agent/0.1" },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return `ERROR: search ${res.status}`;
    const data = await res.json();
    const lines = [];
    if (data.AbstractText) lines.push(data.AbstractText);
    for (const t of data.RelatedTopics || []) {
      if (t.Text) lines.push(t.Text);
      for (const x of t.Topics || []) if (x.Text) lines.push(x.Text);
    }
    return lines.slice(0, 8).join("\n") || "(no results)";
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function fetchUrl(url) {
  if (!/^https?:\/\//i.test(String(url || ""))) return "ERROR: http(s) only";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DAT-STARCODER-agent/0.1" },
      signal: AbortSignal.timeout(15_000),
    });
    const text = (await res.text())
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `status ${res.status}\n${text.slice(0, 12000)}`;
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function ollamaChat(ollamaUrl, model, messages, onToken) {
  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama chat ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("Ollama returned no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let pending = "";
  let lastEmit = 0;

  const flush = async (force = false) => {
    if (!onToken || !pending) return;
    const now = Date.now();
    if (!force && now - lastEmit < 180 && pending.length < 48) return;
    const chunk = pending;
    pending = "";
    lastEmit = now;
    await onToken(chunk, full);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let data;
      try {
        data = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const piece = data.message?.content || "";
      if (piece) {
        full += piece;
        pending += piece;
        await flush(false);
      }
      if (data.done) {
        await flush(true);
        return full;
      }
    }
  }
  await flush(true);
  return full;
}

async function collectLocalFiles(root) {
  const paths = await listTree(root);
  const files = [];
  for (const rel of paths) {
    if (rel.startsWith("turns/")) continue;
    try {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) continue;
      files.push({ path: rel, content });
    } catch {
      /* skip */
    }
  }
  return files;
}

/**
 * @returns {{ result: string, files: {path:string,content:string}[], toolSteps: number }}
 */
export async function runAgentJob({
  job,
  ollamaUrl,
  model,
  pullWorkspace,
  pushWorkspace,
  log = console.log,
  onEvent,
}) {
  const emit = async (type, message, data = null) => {
    if (onEvent) await onEvent({ type, message, data });
  };

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "starcoder-"));
  let toolSteps = 0;
  try {
    await emit("status", `Starting agent · ${model}`);
    const pulled = await pullWorkspace(job);
    for (const f of pulled.files || []) {
      const safe = safeRel(f.path);
      if (!safe) continue;
      const full = path.join(root, safe);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, f.content ?? "", "utf8");
    }

    const messages = [{ role: "system", content: agentSystem(job) }];
    let finalMessage = "";

    for (let step = 0; step < MAX_STEPS; step++) {
      log(`[agent] step ${step + 1}/${MAX_STEPS} job=${job.id.slice(0, 8)}`);
      await emit("log", `Thinking (step ${step + 1}/${MAX_STEPS})…`);
      let content;
      try {
        content = await ollamaChat(
          ollamaUrl,
          model,
          messages,
          async (chunk, draft) => {
            await emit("token", chunk, {
              draft: draft.slice(-4000),
              step: step + 1,
            });
          },
        );
      } catch (err) {
        finalMessage = [
          `# Agent error`,
          "",
          err instanceof Error ? err.message : String(err),
          "",
          "## How to run / play",
          "1. Open Studio → Workspace → Download zip if files exist.",
          "2. Retry the job after confirming Ollama is running.",
        ].join("\n");
        await emit(
          "error",
          err instanceof Error ? err.message : String(err),
        );
        break;
      }

      messages.push({ role: "assistant", content });
      const action = parseAction(content);

      if (!action) {
        messages.push({
          role: "user",
          content:
            'Could not parse JSON. Reply with only one JSON object, e.g. {"tool":"list_files","args":{}} or {"done":true,"message":"..."}',
        });
        continue;
      }

      if (action.done) {
        finalMessage = String(action.message || content);
        await emit("status", "Finishing answer");
        break;
      }

      const tool = action.tool;
      const args = action.args || {};
      toolSteps += 1;
      await emit("tool", String(tool || "unknown"), {
        name: tool,
        args: { ...args, content: args.content ? "[…]" : undefined },
        step: toolSteps,
      });
      let observation = "";
      if (tool === "list_files") {
        observation = await toolList(root);
      } else if (tool === "read_file") {
        observation = await toolRead(root, args.path);
      } else if (tool === "write_file") {
        observation = await toolWrite(root, args.path, args.content);
      } else if (tool === "run") {
        observation = await runCommand(root, String(args.command || "true"));
      } else if (tool === "web_search") {
        observation = await webSearch(args.query);
      } else if (tool === "fetch_url") {
        observation = await fetchUrl(args.url);
      } else if (tool === "clvm_verify") {
        const verified = await clvmVerify(args);
        observation = JSON.stringify(verified);
      } else {
        observation = `ERROR: unknown tool ${tool}`;
      }
      await emit("tool_result", `${tool}: ok`, {
        name: tool,
        summary: String(observation).slice(0, 240),
      });

      messages.push({
        role: "user",
        content: `OBSERVATION:\n${observation}`,
      });
    }

    if (!finalMessage) {
      finalMessage = [
        "# Reached step limit",
        "",
        "I made partial progress in the workspace. Download the zip and continue with another prompt.",
        "",
        "## How to run / play",
        "1. Studio → this job → Workspace → Download zip.",
        "2. Unzip and open the main file (often index.html) or follow README.md.",
      ].join("\n");
    }

    if (!/## How to run \/ play/i.test(finalMessage)) {
      finalMessage += [
        "",
        "## How to run / play",
        "1. In Studio open Workspace → Download zip.",
        "2. Unzip the folder.",
        "3. Open index.html (or follow README.md) to run/play.",
      ].join("\n");
    }

    const files = await collectLocalFiles(root);
    await pushWorkspace(job, files);

    const header = [
      `Model: ${job.modelRequested || "auto"} → ${model}`,
      job.modelReason ? `Reason: ${job.modelReason}` : "",
      job.projectId ? `Project: ${job.projectId}` : "",
      "Mode: tool agent loop",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    return { result: `${header}${finalMessage}`, files, toolSteps };
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
