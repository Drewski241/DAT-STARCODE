/**
 * Tool-using agent loop for DAT STARCODER worker.
 * Operates on a local workspace synced from/to the API.
 */
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import os from "os";
import { fileURLToPath } from "url";
import {
  commitPushAndOpenPr,
  formatPushCommands,
  prepareGithubWorkspace,
  preparePublicGithubWorkspace,
} from "./github.mjs";
import { puzzleHashWithCdv } from "./cdv.mjs";
import { inferGoal } from "./goals.mjs";
import { ensurePuzzleHashDocumented } from "./hash-doc.mjs";
import { verifyWorkspaceFiles } from "./verify.mjs";
import { clvmVerify } from "./clvm-verify.mjs";
import { spendCheck } from "./spend-check.mjs";
import { retrieveKnowledge, packsForProfile } from "./knowledge.mjs";
import {
  probeChialispTooling,
  toolingFailureLines,
} from "./tooling.mjs";
import { seedTemplatesForGoal } from "./seed-templates.mjs";
import { runSecureTreasurySpendFixtures } from "./spend-fixtures.mjs";

const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 12);
const HARD_TASK_STEPS = Number(process.env.AGENT_HARD_TASK_STEPS || 40);
const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS || 20000);
const MAX_FILE_BYTES = 200_000;
const PLAYBOOK_MAX_CHARS = 8_000;
const AGENTS_MD_MAX_CHARS = 4_000;

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

const GENERAL_QNA_RULES = `
This turn is everyday Q&A / local how-to — NOT a coding job.
- Do NOT create PLAN.md, README.md, src/, apps, or other code scaffolds.
- Do NOT tell the user to "just Google it" or "research online". YOU do the research and recommend a clear path.
- BEFORE {"done":true}:
  1) web_search at least twice with specific queries (include city + province + product)
  2) fetch_url at least one official / primary page from those results (e.g. icbc.com for BC vehicles)
- URL honesty: ONLY cite links that appeared in web_search or fetch_url observations. Never invent or remix URLs. If unsure, omit the link and name the organization.
- When the user asks what is best / cheapest / most affordable:
  - Compare 2–4 real purchase PATHS (e.g. ICBC Autoplan broker vs BCAA vs independent broker), not vague brand name-drops
  - In BC: basic motorcycle liability is through ICBC (Autoplan). Optional collision/comprehensive/roadside may be ICBC and/or private — say what you verified from fetched pages
  - Explain mandatory vs optional; list cost drivers (cc, sport bike class, experience, claims, storage, commute)
  - Rank the *process* to get the lowest honest price (which quotes, in what order) — e.g. get ICBC basic quote + 2 optional quotes same day
  - Do NOT invent dollar premiums. Exact price needs their details via a licensed quote.
  - Include a ## Sources section with real URLs from your tool observations
  - Link label must match the real site (domain/title from OBSERVATION). Never rename a blog URL as a broker brand.
  - End with one "best next move for you" tied to their bike/city
- Put plain markdown in "message" only (use \\n for newlines in JSON). Never leave the {"done":true...} wrapper visible.
- Sections: recommendation → comparison → how to quote → caveats → ## Sources → ## Next steps
`.trim();

const SHOPPING_HINT =
  /\b(best|cheap|cheapest|affordable|lowest|compare|comparison|which|vs\b|versus|quote|quotes|buy|purchase|insurance|broker|price|cost)\b/i;

const QUALITY_RULES = `
Quality rules:
- Infer the user's end goal from a short prompt; use the domain playbook(s) below — do not wait for a novel-length spec.
- For hard goals: FIRST write_file PLAN.md (Goal / Done when / Files), then implement.
- Never claim you deleted or fixed a file unless you verified with list_files / read_file after.
- rm / unlink of files that were pulled from Studio are synced back (workspace deletes). Prefer real deletes over leaving NOTE stubs.
- If the user asks for ChiaLisp / .clsp: write real ChiaLisp starting with (mod — never Common Lisp.
- When the puzzle_hash tool is available, use it after writing .clsp and document the hash under ## Puzzle hash in docs/PUZZLE_HASH.md.
- Before {"done":true} on a .clsp task, read_file the puzzle and confirm it has (mod and no defparameter/let*/mapcar.
`.trim();

async function loadPlaybook(name) {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const p = path.join(here, "playbooks", name);
    const text = await fs.readFile(p, "utf8");
    return text.slice(0, PLAYBOOK_MAX_CHARS);
  } catch {
    return null;
  }
}

async function loadPlaybooks(names) {
  const chunks = [];
  for (const name of names || []) {
    const text = await loadPlaybook(name);
    if (text) chunks.push(`### ${name}\n${text}`);
  }
  const joined = chunks.join("\n\n");
  return joined ? joined.slice(0, PLAYBOOK_MAX_CHARS) : null;
}

async function loadRepoAgentsMd(root) {
  for (const rel of ["AGENTS.md", "agents.md", ".cursorrules"]) {
    try {
      const text = await fs.readFile(path.join(root, rel), "utf8");
      if (text.trim()) return `${rel}:\n${text.slice(0, AGENTS_MD_MAX_CHARS)}`;
    } catch {
      /* missing */
    }
  }
  return null;
}

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

const BLOCKED_RUN =
  /\b(sudo|pkexec|passwd|su\b|visudo|shutdown|reboot|halt|poweroff)\b/i;

function runCommand(root, command) {
  const cmd = String(command || "").trim();
  if (!cmd) {
    return Promise.resolve("ERROR: empty command");
  }
  if (BLOCKED_RUN.test(cmd)) {
    return Promise.resolve(
      "ERROR: interactive/privileged commands (sudo, su, passwd, …) are blocked. Use user-level tools only (npm, node, python, …).",
    );
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: root,
      shell: true,
      env: {
        ...process.env,
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DEBIAN_FRONTEND: "noninteractive",
        CI: "1",
        npm_config_fund: "false",
        npm_config_audit: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
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
      /* Models often put raw newlines inside "message" — recover below. */
    }
  }
  // Recover {"done":true,"message":"..."} when message contains unescaped newlines.
  if (/"done"\s*:\s*true/i.test(candidate)) {
    const msgMatch = candidate.match(
      /"message"\s*:\s*"([\s\S]*)"\s*,?\s*(?:"[^"]+"\s*:\s*[^,}]+,?\s*)*\}\s*$/i,
    );
    const loose = candidate.match(/"message"\s*:\s*"([\s\S]*)"\s*\}\s*$/i);
    const body = (msgMatch || loose)?.[1];
    if (body != null) {
      return {
        done: true,
        message: body
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\"),
      };
    }
  }
  // DONE: message
  const done = raw.match(/^DONE:\s*([\s\S]+)/i);
  if (done) return { done: true, message: done[1].trim() };
  return null;
}

/** Strip a leftover {"done":true,"message":"..."} envelope from user-visible text. */
function unwrapDoneMessage(text) {
  const raw = String(text || "").trim();
  const parsed = parseAction(raw);
  if (parsed?.done && typeof parsed.message === "string" && parsed.message.trim()) {
    return parsed.message.trim();
  }
  if (/^\s*\{[\s\S]*"done"\s*:\s*true/i.test(raw)) {
    const loose = raw.match(/"message"\s*:\s*"([\s\S]*)"\s*\}\s*$/i);
    if (loose?.[1]) {
      return loose[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .trim();
    }
  }
  return raw;
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

function agentSystem(job, github, githubClone, extras = {}) {
  const repoLabel =
    github?.repoFullName ||
    githubClone?.fullName ||
    null;
  const isGeneral = extras.goal?.id === "general";
  const githubMode = isGeneral
    ? "This is an advice / research turn — ignore GitHub unless the user asked about a repo."
    : github
      ? `This workspace is a clone of GitHub repo ${github.repoFullName}. After you finish, the worker will commit, push a branch, and open a pull request automatically — focus on making good file changes.`
      : githubClone
        ? `This workspace is a clone of public GitHub repo ${githubClone.fullName}. After you finish, the user will push with terminal commands printed in the result — focus on making good file changes. Do not commit or push yourself.`
        : "This workspace syncs to Studio download zip (no GitHub repo linked).";
  const profile = detectProfile(job.prompt || "");
  const packs = packsForProfile(isGeneral ? "general" : profile);
  const chunks = retrieveKnowledge(job.prompt || "", { packs, limit: 3 });
  const knowledge =
    chunks.length === 0
      ? ""
      : [
          "Retrieved knowledge:",
          ...chunks.map((c) => `### ${c.title}\n${c.text}`),
        ].join("\n\n");

  if (isGeneral) {
    return [
      "You are DAT STARCODER, a careful research assistant for everyday and local questions.",
      UNBIASED_QNA,
      GENERAL_QNA_RULES,
      githubMode,
      "On every turn respond with ONLY one JSON object (optionally in a ```json fence):",
      "",
      '1) Call a tool: {"thought":"...","tool":"web_search"|"fetch_url","args":{...}}',
      '   - web_search args: {"query":"..."}',
      '   - fetch_url args: {"url":"https://..."}',
      "",
      '2) Finish: {"done":true,"message":"markdown answer for the user"}',
      "",
      "Do not use list_files/write_file/run for this turn unless the user explicitly asked for files.",
      knowledge,
      extras.goal
        ? `\n## Inferred goal\n${extras.goal.label} (\`${extras.goal.id}\`)\n`
        : "",
      job.context ? `\nPrior context:\n${job.context}\n` : "",
      "",
      "User request:",
      job.prompt,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "You are DAT STARCODER, a robust coding and help agent with tools.",
    "You work inside a real project workspace on disk when coding.",
    "You also help with Windows / macOS / ChromeOS / Linux how-tos and everyday questions.",
    UNBIASED_QNA,
    githubMode,
    profile === "chialisp"
      ? "For ChiaLisp/CLVM you MUST call clvm_verify (brun/run) and puzzle_hash (cdv) before finishing. Worker tooling is required — do not claim success if they fail."
      : "",
    "On every turn respond with ONLY one JSON object (optionally in a ```json fence):",
    "",
    '1) Call a tool: {"thought":"...","tool":"list_files"|"read_file"|"write_file"|"run"|"web_search"|"fetch_url"|"clvm_verify"|"spend_check"|"puzzle_hash","args":{...}}',
    '   - list_files args: {}',
    '   - read_file args: {"path":"relative/path"}',
    '   - write_file args: {"path":"relative/path","content":"full file contents"}',
    '   - run args: {"command":"shell command in the workspace"}',
    '   - web_search args: {"query":"..."}',
    '   - fetch_url args: {"url":"https://..."}',
    '   - clvm_verify args: {"program":"...","solution":"()","mode":"brun"|"run","expect":"optional"}',
    '   - spend_check args: {"program":"...","samples":[{"name":"deposit","solution":"(…)","mode":"brun"}]}',
    '   - puzzle_hash args: {"path":"puzzles/foo.clsp","curryArgs":["optional","cdv","-a","values"]}',
    "",
    '2) Finish: {"done":true,"message":"markdown answer for the user"}',
    "",
    "Rules:",
    "- Explore with list_files/read_file before editing when files may already exist.",
    "- Prefer small, working changes. Write complete files when creating them.",
    "- Use run to install/build/test when helpful (keep commands short).",
    "- Use web_search when facts may be stale (OS menus, docs, current APIs).",
    "- Never use sudo, su, passwd, or other interactive/privileged commands.",
    "- Prefer static HTML/JS games/apps that need no system packages when possible.",
    "- For games/apps, make something runnable (often index.html).",
    "- Do not commit or push yourself; the worker handles git/PR or prints push commands.",
    QUALITY_RULES,
    HOW_TO_RUN,
    knowledge,
    extras.goal
      ? `\n## Inferred goal\n${extras.goal.label} (\`${extras.goal.id}\`)${
          extras.tooling
            ? extras.tooling.ok
              ? " · cdv + clvm_tools ready"
              : ` · TOOLING MISSING: ${extras.tooling.missing.join(", ")} — install before finishing`
            : extras.cdvAvailable
              ? " · cdv available (use puzzle_hash)"
              : " · cdv not installed on worker"
        }\n`
      : "",
    extras.playbook
      ? `\n## Domain playbook (follow strictly)\n${extras.playbook}\n`
      : "",
    extras.agentsMd
      ? `\n## Repository agent instructions\n${extras.agentsMd}\n`
      : "",
    job.projectId ? `Project id: ${job.projectId}` : "",
    repoLabel
      ? `GitHub repo: ${repoLabel} (base ${github?.defaultBranch || githubClone?.defaultBranch || "main"})`
      : "",
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
  if (!q) return "ERROR: empty query";
  const ua = {
    "User-Agent":
      "DAT-STARCODER-agent/0.1 (research; +https://datstarcoder.com)",
  };
  const lines = [];
  try {
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(apiUrl, {
      headers: ua,
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.Heading) lines.push(`Heading: ${data.Heading}`);
      if (data.AbstractText) lines.push(data.AbstractText);
      if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
      for (const t of data.RelatedTopics || []) {
        if (t.Text) lines.push(t.Text);
        if (t.FirstURL) lines.push(`URL: ${t.FirstURL}`);
        for (const x of t.Topics || []) {
          if (x.Text) lines.push(x.Text);
          if (x.FirstURL) lines.push(`URL: ${x.FirstURL}`);
        }
      }
      for (const r of data.Results || []) {
        if (r.Text) lines.push(r.Text);
        if (r.FirstURL) lines.push(`URL: ${r.FirstURL}`);
      }
    }
  } catch (err) {
    lines.push(
      `API search note: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Instant-answer API is often empty for local queries — also scrape lite HTML.
  if (lines.filter((l) => !l.startsWith("API search")).length < 2) {
    try {
      const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const res = await fetch(htmlUrl, {
        headers: { ...ua, Accept: "text/html" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const html = await res.text();
        const re =
          /uddg=([^&"]+)[^>]*>[\s\S]*?class="result__a"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        let n = 0;
        while ((m = re.exec(html)) && n < 6) {
          let link = m[1];
          try {
            link = decodeURIComponent(link);
          } catch {
            /* keep */
          }
          const title = m[2].replace(/<[^>]+>/g, "").trim();
          const snip = m[3].replace(/<[^>]+>/g, "").trim();
          if (title) lines.push(`${title}\n${snip}\nURL: ${link}`);
          n += 1;
        }
        if (n === 0) {
          // Fallback: simpler title+url pairs
          const loose =
            /class="result__a"[^>]*href="[^"]*uddg=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
          while ((m = loose.exec(html)) && n < 6) {
            let link = m[1];
            try {
              link = decodeURIComponent(link);
            } catch {
              /* keep */
            }
            const title = m[2].replace(/<[^>]+>/g, "").trim();
            if (title) lines.push(`${title}\nURL: ${link}`);
            n += 1;
          }
        }
      }
    } catch (err) {
      lines.push(
        `HTML search note: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return lines.slice(0, 14).join("\n\n") || "(no results — try a more specific query)";
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

const SKIP_PUSH_NAME =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.DS_Store)$/i;
const SKIP_PUSH_DIR = /(^|\/)(node_modules|dist|build|\.next|coverage|\.git)\//;

async function collectLocalFiles(root) {
  const paths = await listTree(root);
  const files = [];
  for (const rel of paths) {
    if (rel.startsWith("turns/")) continue;
    if (SKIP_PUSH_NAME.test(rel) || SKIP_PUSH_DIR.test(rel)) continue;
    try {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) continue;
      files.push({ path: rel, content });
    } catch {
      /* skip binary / unreadable */
    }
  }
  return files;
}

/**
 * @returns {{ result: string, files: {path:string,content:string}[], githubBranch?: string|null, githubPrUrl?: string|null }}
 */
export async function runAgentJob({
  job,
  ollamaUrl,
  model,
  pullWorkspace,
  pushWorkspace,
  github = null,
  githubClone = null,
  log = console.log,
  onEvent,
}) {
  const emit = async (type, message, data = null) => {
    if (onEvent) await onEvent({ type, message, data });
  };

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "starcoder-"));
  let githubBranch = null;
  let githubPrUrl = null;
  let toolSteps = 0;
  /** @type {"oauth"|"commands"|null} */
  let githubPath = null;
  try {
    await emit("status", `Starting agent · ${model}`);
    const pulled = await pullWorkspace(job);
    /** Paths that existed in Studio before this turn — used to detect deletes. */
    const pulledPaths = [];
    for (const f of pulled.files || []) {
      const safe = safeRel(f.path);
      if (!safe) continue;
      pulledPaths.push(safe);
      const full = path.join(root, safe);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, f.content ?? "", "utf8");
    }

    if (github) {
      githubPath = "oauth";
      log(
        `[agent] github prepare ${github.repoFullName} base=${github.defaultBranch}`,
      );
      try {
        const prepared = await prepareGithubWorkspace(root, github, job);
        githubBranch = prepared.branch;
        log(`[agent] github branch ${githubBranch}`);
      } catch (err) {
        log(
          `[agent] github prepare failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (githubClone) {
      githubPath = "commands";
      log(
        `[agent] github public clone ${githubClone.fullName} base=${githubClone.defaultBranch}`,
      );
      try {
        const prepared = await preparePublicGithubWorkspace(
          root,
          githubClone,
          job,
        );
        githubBranch = prepared.branch;
        log(`[agent] github branch ${githubBranch} (user will push)`);
      } catch (err) {
        // Private or missing repo — keep workspace files; still print push cmds.
        githubBranch = `dat-starcoder/${job.id.slice(0, 8)}`;
        log(
          `[agent] github public clone failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Include continue context so "summarize the puzzles" stays hard-domain.
    const goal = inferGoal(
      [job.prompt, job.context].filter(Boolean).join("\n"),
    );
    const hardTask = goal.hard;
    const isGeneral = goal.id === "general";
    const isShopping = isGeneral && SHOPPING_HINT.test(job.prompt || "");
    // Shopping needs a few tool calls + one synthesis — keep budget modest so
    // the model finishes instead of tool-looping until the cap.
    const stepLimit = hardTask
      ? HARD_TASK_STEPS
      : isShopping
        ? Math.max(MAX_STEPS, 10)
        : MAX_STEPS;

    if (!isGeneral && hardTask) {
      try {
        await seedTemplatesForGoal(root, goal.id, { log });
      } catch (err) {
        log(
          `[agent] seed templates: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const playbook = await loadPlaybooks(goal.playbooks);
    const tooling =
      goal.wantCdv || hardTask ? await probeChialispTooling() : null;
    const hasCdv = Boolean(tooling?.cdv);
    const toolingReady = Boolean(tooling?.ok);
    const requireTooling = Boolean(
      hardTask && tooling && tooling.required,
    );
    if (playbook) {
      log(
        `[agent] goal=${goal.id} playbooks=${goal.playbooks.join(",") || "-"} (${playbook.length} chars) cdv=${hasCdv} clvm_tools=${Boolean(tooling?.clvmTools)} requireTooling=${requireTooling}`,
      );
    } else {
      log(`[agent] goal=${goal.id}`);
    }
    if (requireTooling && tooling && !tooling.ok) {
      for (const line of toolingFailureLines(tooling)) {
        log(`[agent] tooling: ${line}`);
      }
    }
    const agentsMd = isGeneral ? null : await loadRepoAgentsMd(root);
    if (agentsMd) log(`[agent] loaded repo agent instructions`);

    const messages = [
      {
        role: "system",
        content: agentSystem(job, github, githubClone, {
          playbook,
          agentsMd,
          goal,
          cdvAvailable: hasCdv,
          tooling,
        }),
      },
    ];
    let finalMessage = "";
    let stepsUsed = 0;
    let researchSteps = 0;
    let searchSteps = 0;
    let fetchSteps = 0;
    /** @type {Set<string>} */
    const knownUrls = new Set();

    const isUsefulSourceUrl = (u) => {
      try {
        const url = new URL(u);
        const host = url.hostname.replace(/^www\./, "").toLowerCase();
        const path = url.pathname.toLowerCase();
        // Drop assets / CDNs that leak out of fetch_url HTML.
        if (
          /\.(css|js|mjs|map|woff2?|ttf|eot|png|jpe?g|gif|svg|ico|webp|mp4|webm)(\?|$)/i.test(
            path,
          )
        ) {
          return false;
        }
        if (
          /(^|\.)(typekit\.net|googleapis\.com|gstatic\.com|google-analytics\.com|googletagmanager\.com|facebook\.com|doubleclick\.net|scorecardresearch\.com|hotjar\.com|cloudflareinsights\.com)$/i.test(
            host,
          )
        ) {
          return false;
        }
        if (host === "duckduckgo.com" || host.endsWith(".duckduckgo.com")) {
          return false;
        }
        return /^https?:$/i.test(url.protocol);
      } catch {
        return false;
      }
    };

    const rememberUrls = (text) => {
      const re = /https?:\/\/[^\s\)\]\>\"']+/gi;
      let m;
      while ((m = re.exec(String(text || "")))) {
        const u = m[0].replace(/[.,;\\]+$/, "");
        if (!isUsefulSourceUrl(u)) continue;
        knownUrls.add(u);
        try {
          const host = new URL(u).hostname.replace(/^www\./, "");
          if (host) knownUrls.add(host);
        } catch {
          /* ignore */
        }
      }
    };

    const researchReady = () => {
      if (!isGeneral) return true;
      if (isShopping) {
        // One solid search + one official fetch is enough to write the answer.
        return searchSteps >= 1 && fetchSteps >= 1;
      }
      return searchSteps >= 1;
    };

    const polishDraft = (raw, { forceSources = false } = {}) => {
      let draft = unwrapDoneMessage(raw);
      // Fix common heading glitches from models ("### ## Sources").
      draft = draft
        .replace(/^#{1,6}\s+#{1,6}\s+/gm, "## ")
        .replace(/\n#{1,6}\s+#{1,6}\s+/g, "\n## ");
      if (isGeneral && knownUrls.size > 0) {
        draft = draft.replace(
          /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
          (full, label, url) => {
            const clean = url.replace(/[.,;]+$/, "");
            let host = "";
            try {
              host = new URL(clean).hostname.replace(/^www\./, "");
            } catch {
              return label;
            }
            // Require the full URL (not just host) so a blog isn't labeled "Acera".
            if (knownUrls.has(clean)) return `[${host}](${clean})`;
            if (knownUrls.has(host)) return `[${host}](${clean})`;
            return `${label} (${host} — verify; link not confirmed in research)`;
          },
        );
      }
      if (isShopping || forceSources) {
        const httpSources = [...knownUrls].filter((u) =>
          /^https?:\/\//i.test(u),
        );
        if (httpSources.length) {
          // Replace model Sources with confirmed research URLs only.
          draft = draft.replace(/\n##\s*Sources\b[\s\S]*?(?=\n##\s|\s*$)/i, "");
          draft += [
            "",
            "## Sources",
            ...httpSources.slice(0, 8).map((u) => {
              try {
                return `- [${new URL(u).hostname.replace(/^www\./, "")}](${u})`;
              } catch {
                return `- ${u}`;
              }
            }),
          ].join("\n");
        }
      }
      return draft.trim();
    };

    const finishNudge = () =>
      [
        "STOP calling tools.",
        'Reply NOW with only: {"done":true,"message":"..."}',
        "Use the OBSERVATION research already gathered.",
        "Include ranked purchase paths, caveats (no invented premiums), ## Sources with real https URLs from observations, and ## Next steps.",
      ].join(" ");

    for (let step = 0; step < stepLimit; step++) {
      stepsUsed = step + 1;
      const stepsLeft = stepLimit - step;
      log(`[agent] step ${step + 1}/${stepLimit} job=${job.id.slice(0, 8)}`);
      await emit("log", `Thinking (step ${step + 1}/${stepLimit})…`);

      // Force synthesis before the budget dies.
      if (isGeneral && researchReady() && stepsLeft <= 3) {
        messages.push({ role: "user", content: finishNudge() });
      } else if (isGeneral && stepsLeft <= 2) {
        messages.push({
          role: "user",
          content:
            finishNudge() +
            " If research is thin, still answer with best-effort paths and say what you could not verify.",
        });
      }

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
          isGeneral
            ? "## Next steps\n1. Retry after confirming Ollama is running."
            : [
                "## How to run / play",
                "1. Open Studio → Workspace → Download zip if files exist.",
                "2. Retry the job after confirming Ollama is running and the selected model is pulled (`ollama list`).",
              ].join("\n"),
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
          content: isGeneral
            ? 'Could not parse JSON. Reply with only one JSON object, e.g. {"tool":"web_search","args":{"query":"..."}} or {"done":true,"message":"..."}'
            : 'Could not parse JSON. Reply with only one JSON object, e.g. {"tool":"list_files","args":{}} or {"done":true,"message":"..."}',
        });
        continue;
      }

      if (action.done) {
        const mustKeepResearching =
          isGeneral &&
          !researchReady() &&
          stepsLeft > 2;
        if (mustKeepResearching) {
          messages.push({
            role: "user",
            content: isShopping
              ? 'Not done yet. Call web_search (if needed) and fetch_url one official page from results (prefer icbc.com), then {"done":true,...} with ranked paths. Do not invent prices or URLs.'
              : 'You must research before finishing. Call web_search now, then synthesize a concrete answer. Do not tell the user to Google it themselves.',
          });
          continue;
        }
        let draft = String(action.message || content);
        if (
          isShopping &&
          !/https?:\/\//i.test(draft) &&
          [...knownUrls].some((u) => /^https?:\/\//i.test(u)) &&
          stepsLeft > 2
        ) {
          messages.push({
            role: "user",
            content:
              "Your draft has no real https links. Rewrite with ## Sources using ONLY URLs from OBSERVATION. Do not invent links.",
          });
          continue;
        }
        finalMessage = polishDraft(draft, { forceSources: true });
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
        // Nudge + precompute hash as soon as a .clsp lands (don't burn steps).
        if (hasCdv && /\.clsp$/i.test(String(args.path || ""))) {
          const result = await puzzleHashWithCdv(root, String(args.path || ""), {});
          observation += `\n\nAUTO puzzle_hash:\n${JSON.stringify(result, null, 2)}`;
          if (result.puzzleHash) {
            observation +=
              `\n\nNEXT: write_file docs/PUZZLE_HASH.md with section:\n## Puzzle hash\n\n\`${result.puzzleHash}\`\n(no 0x prefix)${result.curried ? " — curried with demo args; re-run puzzle_hash with real curryArgs for mainnet." : ""}. Then done.`;
          }
        }
      } else if (tool === "run") {
        observation = await runCommand(root, String(args.command || "true"));
      } else if (tool === "web_search") {
        observation = await webSearch(args.query);
        researchSteps += 1;
        searchSteps += 1;
        rememberUrls(observation);
      } else if (tool === "fetch_url") {
        observation = await fetchUrl(args.url);
        researchSteps += 1;
        fetchSteps += 1;
        rememberUrls(String(args.url || ""));
        rememberUrls(observation);
      } else if (isGeneral && (tool === "write_file" || tool === "run")) {
        observation =
          "ERROR: this is a general Q&A turn — do not create code or run shell. Use web_search / fetch_url, then {" +
          '"done":true,"message":"..."} with a concrete answer.';
      } else if (tool === "clvm_verify") {
        const verified = await clvmVerify(args);
        observation = JSON.stringify(verified);
      } else if (tool === "spend_check") {
        const checked = await spendCheck({
          program: args.program,
          samples: args.samples,
        });
        observation = JSON.stringify(checked, null, 2);
      } else if (tool === "puzzle_hash") {
        const result = await puzzleHashWithCdv(root, String(args.path || ""), {
          curryArgs: args.curryArgs,
        });
        observation = JSON.stringify(result, null, 2);
      } else {
        observation = `ERROR: unknown tool ${tool}`;
      }
      await emit("tool_result", `${tool}: ok`, {
        name: tool,
        summary: String(observation).slice(0, 240),
      });

      let obsMsg = `OBSERVATION:\n${observation}`;
      if (isGeneral && researchReady()) {
        obsMsg += `\n\n${finishNudge()}`;
      }
      messages.push({
        role: "user",
        content: obsMsg,
      });
    }

    // Last-chance synthesis so shopping Q&A never dies on "step limit" alone.
    if (!finalMessage && isGeneral && researchSteps > 0) {
      try {
        await emit("status", "Synthesizing answer from research…");
        messages.push({ role: "user", content: finishNudge() });
        const content = await ollamaChat(ollamaUrl, model, messages);
        messages.push({ role: "assistant", content });
        const action = parseAction(content);
        if (action?.done) {
          finalMessage = polishDraft(action.message || content, {
            forceSources: true,
          });
        } else if (content && content.length > 80) {
          finalMessage = polishDraft(content, { forceSources: true });
        }
      } catch (err) {
        log(
          `[agent] final synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!finalMessage) {
      finalMessage = isGeneral
        ? polishDraft(
            [
              "# Partial research",
              "",
              "I gathered some sources but could not finish a full ranked comparison in time.",
              researchSteps
                ? "Use the Sources below, or send a follow-up like “finish the ICBC vs BCAA vs broker ranking”."
                : "Retry the question — I did not get useful search results.",
              "",
              "## Next steps",
              "1. Follow-up: ask me to finish the ranking from research already done.",
              "2. Or tell me licence class / new vs used bike for a tighter recommendation.",
            ].join("\n"),
            { forceSources: true },
          )
        : [
            "# Reached step limit",
            "",
            "I made partial progress in the workspace. Download the zip and continue with another prompt.",
            "",
            "## How to run / play",
            "1. Studio → this job → Workspace → Download zip.",
            "2. Unzip and open the main file (often index.html) or follow README.md.",
          ].join("\n");
    }

    if (isGeneral) {
      if (!/## Next steps/i.test(finalMessage)) {
        finalMessage += [
          "",
          "## Next steps",
          "1. Open the official insurer / broker links from the answer above.",
          "2. Have your licence, VIN/bike details, and address ready for a quote.",
          "3. Ask a follow-up here if you want help comparing two options.",
        ].join("\n");
      }
    } else if (!/## How to run \/ play/i.test(finalMessage)) {
      finalMessage += [
        "",
        "## How to run / play",
        "1. In Studio open Workspace → Download zip.",
        "2. Unzip the folder.",
        "3. Open index.html (or follow README.md) to run/play.",
      ].join("\n");
    }

    // Deterministic: do not rely on the model to remember puzzle_hash.
    let hashDoc = null;
    if (hardTask && hasCdv) {
      try {
        hashDoc = await ensurePuzzleHashDocumented(root, { log });
        if (hashDoc.ok && hashDoc.puzzleHash) {
          finalMessage += [
            "",
            "## Puzzle hash",
            "",
            `\`${hashDoc.puzzleHash}\``,
            "",
            `_(auto-documented from cdv on \`${hashDoc.path}\` → ${hashDoc.docsPath || "docs/PUZZLE_HASH.md"})_`,
          ].join("\n");
        } else if (hashDoc && !hashDoc.ok) {
          log(`[agent] hash-doc: ${hashDoc.message}`);
        }
      } catch (err) {
        log(
          `[agent] hash-doc error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (hardTask && requireTooling && !hasCdv) {
      log("[agent] hash-doc skipped — cdv required but not available");
    }

    // Deterministic fail-closed spend samples for secure treasury (flash / cover / zero).
    /** @type {{ ok: boolean, message: string, results?: any[] }|null} */
    let spendFx = null;
    if (goal.id === "secure_treasury") {
      try {
        spendFx = await runSecureTreasurySpendFixtures(root, { log });
        log(`[agent] spend-fixtures: ${spendFx.message}`);
      } catch (err) {
        spendFx = {
          ok: false,
          message: `spend fixtures error: ${err instanceof Error ? err.message : String(err)}`,
          results: [],
        };
        log(`[agent] spend-fixtures error: ${spendFx.message}`);
      }
    }

    // General Q&A should not litter the project workspace with scaffold files.
    let files = isGeneral ? [] : await collectLocalFiles(root);

    // Drop leftover root stubs that fail sibling CREATE_COIN checks when the
    // real puzzles/savings_vault.clsp pair is present (any hard goal).
    if (!isGeneral) {
      const hasVault = files.some((f) =>
        /puzzles\/savings_vault\.clsp$/i.test(f.path),
      );
      const stubPaths = files
        .filter(
          (f) =>
            /^secure_treasury\.clsp$/i.test(f.path) ||
            /^pool_coin\.clsp$/i.test(f.path),
        )
        .map((f) => f.path);
      if (hasVault && stubPaths.length) {
        for (const rel of stubPaths) {
          try {
            await fs.unlink(path.join(root, rel));
            log(`[agent] removed leftover stub ${rel}`);
          } catch {
            /* ignore */
          }
        }
        files = files.filter((f) => !stubPaths.includes(f.path));
        finalMessage += [
          "",
          "## Cleanup",
          "",
          `Removed leftover stub(s): ${stubPaths.map((p) => `\`${p}\``).join(", ")} (use \`puzzles/savings_vault.clsp\` + \`puzzles/treasury_coin.clsp\`).`,
        ].join("\n");
      }
    }

    if (!isGeneral) {
      const verification = verifyWorkspaceFiles(files, {
        // Always require a documented hash on hard tasks when tooling is mandated.
        requireHash: hardTask && (hasCdv || requireTooling),
        resultText: finalMessage,
        toolingOk: requireTooling ? toolingReady : undefined,
        toolingMissing: tooling?.missing,
        strictSingleton:
          goal.id === "secure_treasury" || goal.id === "mtt_pool",
        secureTreasury: goal.id === "secure_treasury",
      });
      if (spendFx && !spendFx.ok) {
        verification.ok = false;
        verification.failures.push(
          spendFx.message,
          ...(spendFx.results || [])
            .filter((r) => !r.ok)
            .map(
              (r) =>
                `spend fixture: ${r.path}${r.name ? ` :: ${r.name}` : ""}${r.why ? ` — ${r.why}` : ""}${r.error ? ` (${r.error})` : ""}`,
            ),
        );
      }
      if (!verification.ok) {
        log(`[agent] verification failed: ${verification.failures.join("; ")}`);
        finalMessage += [
          "",
          "## Verification failed",
          "",
          "DAT STARCODER checked the workspace and rejected these deliverables:",
          ...verification.failures.map((f) => `- ${f}`),
          "",
          "Do not treat this turn as done. Re-run with a fix prompt (or a stronger model).",
        ].join("\n");
      } else if (hardTask) {
        const clsp = files.filter((f) => /\.clsp$/i.test(f.path));
        if (clsp.length === 0) {
          finalMessage += [
            "",
            "## Verification failed",
            "",
            "- Hard-domain goal expected a `.clsp` (or ChiaLisp) deliverable, but none was written.",
          ].join("\n");
        }
      }
      if (verification.warnings?.length) {
        finalMessage += [
          "",
          "## Verification notes",
          ...verification.warnings.map((w) => `- ${w}`),
        ].join("\n");
      }
    }

    // Paths that were in Studio at pull but are gone on disk → delete from S3.
    const deletePaths = [];
    if (!isGeneral) {
      for (const rel of pulledPaths) {
        try {
          await fs.access(path.join(root, rel));
        } catch {
          deletePaths.push(rel);
        }
      }
      if (deletePaths.length) {
        log(
          `[agent] workspace deletes (${deletePaths.length}): ${deletePaths.slice(0, 12).join(", ")}${deletePaths.length > 12 ? "…" : ""}`,
        );
      }
    }
    await pushWorkspace(job, files, deletePaths);

    if (githubPath === "oauth" && github && githubBranch) {
      try {
        log(`[agent] github commit/push/PR on ${githubBranch}`);
        const shipped = await commitPushAndOpenPr(
          root,
          github,
          job,
          githubBranch,
        );
        githubBranch = shipped.branch;
        githubPrUrl = shipped.prUrl;
        if (shipped.note) log(`[agent] github: ${shipped.note}`);
        if (githubPrUrl) {
          finalMessage += `\n\n## Pull request\n\n${githubPrUrl}\n`;
        } else if (githubBranch) {
          finalMessage += `\n\n## GitHub branch\n\n\`${githubBranch}\` pushed to ${github.repoFullName}.\n`;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[agent] github ship failed: ${msg}`);
        finalMessage += `\n\n## GitHub\n\nPush/PR failed: ${msg}\n`;
      }
    } else if (githubPath === "commands" && githubClone && githubBranch) {
      finalMessage += `\n\n${formatPushCommands({ githubClone, branch: githubBranch, job })}\n`;
    }

    const repoName =
      github?.repoFullName || githubClone?.fullName || null;
    const header = [
      `Model: ${job.modelRequested || "auto"} → ${model}`,
      job.modelReason ? `Reason: ${job.modelReason}` : "",
      job.projectId ? `Project: ${job.projectId}` : "",
      repoName ? `GitHub: ${repoName}` : "",
      githubPrUrl
        ? `PR: ${githubPrUrl}`
        : githubBranch
          ? `Branch: ${githubBranch}${githubPath === "commands" ? " (push with commands below)" : ""}`
          : "",
      `Steps: ${stepsUsed}/${stepLimit}`,
      `Goal: ${goal.id}${hasCdv ? " · cdv" : ""}${tooling?.clvmTools ? " · clvm_tools" : ""}${requireTooling && !toolingReady ? " · TOOLING FAIL" : ""}`,
      "Mode: tool agent loop",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      result: `${header}${finalMessage}`,
      files,
      githubBranch,
      githubPrUrl,
      stepsUsed,
      toolSteps,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
