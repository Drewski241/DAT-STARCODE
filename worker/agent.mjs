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
import { verifyWorkspaceFiles, wantsChialisp } from "./verify.mjs";

const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 12);
const HARD_TASK_STEPS = Number(process.env.AGENT_HARD_TASK_STEPS || 40);
const RUN_TIMEOUT_MS = Number(process.env.AGENT_RUN_TIMEOUT_MS || 20000);
const MAX_FILE_BYTES = 200_000;
const PLAYBOOK_MAX_CHARS = 6_000;
const AGENTS_MD_MAX_CHARS = 4_000;

const HOW_TO_RUN = `
Always end your final answer with a section titled exactly: ## How to run / play
Write numbered steps for a non-technical user. Include: download zip from Studio
Workspace (if needed), unzip, which file to open or command to run, controls/usage,
and common fixes. Never stop at only "download the zip".
`.trim();

const QUALITY_RULES = `
Quality rules:
- Never claim you deleted or fixed a file unless you verified with list_files / read_file after.
- If the user asks for ChiaLisp / .clsp: write real ChiaLisp starting with (mod — never Common Lisp.
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
      /* fall through */
    }
  }
  // DONE: message
  const done = raw.match(/^DONE:\s*([\s\S]+)/i);
  if (done) return { done: true, message: done[1].trim() };
  return null;
}

function agentSystem(job, github, githubClone, extras = {}) {
  const repoLabel =
    github?.repoFullName ||
    githubClone?.fullName ||
    null;
  const githubMode = github
    ? `This workspace is a clone of GitHub repo ${github.repoFullName}. After you finish, the worker will commit, push a branch, and open a pull request automatically — focus on making good file changes.`
    : githubClone
      ? `This workspace is a clone of public GitHub repo ${githubClone.fullName}. After you finish, the user will push with terminal commands printed in the result — focus on making good file changes. Do not commit or push yourself.`
      : "This workspace syncs to Studio download zip (no GitHub repo linked).";
  return [
    "You are DAT STARCODER, a robust coding agent with tools.",
    "You work inside a real project workspace on disk.",
    githubMode,
    "On every turn respond with ONLY one JSON object (optionally in a ```json fence):",
    "",
    '1) Call a tool: {"thought":"...","tool":"list_files"|"read_file"|"write_file"|"run","args":{...}}',
    '   - list_files args: {}',
    '   - read_file args: {"path":"relative/path"}',
    '   - write_file args: {"path":"relative/path","content":"full file contents"}',
    '   - run args: {"command":"shell command in the workspace"}',
    "",
    '2) Finish: {"done":true,"message":"markdown answer for the user"}',
    "",
    "Rules:",
    "- Explore with list_files/read_file before editing when files may already exist.",
    "- Prefer small, working changes. Write complete files when creating them.",
    "- Use run to install/build/test when helpful (keep commands short).",
    "- Never use sudo, su, passwd, or other interactive/privileged commands.",
    "- Prefer static HTML/JS games/apps that need no system packages when possible.",
    "- For games/apps, make something runnable (often index.html).",
    "- Do not commit or push yourself; the worker handles git/PR or prints push commands.",
    QUALITY_RULES,
    HOW_TO_RUN,
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

async function ollamaChat(ollamaUrl, model, messages) {
  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama chat ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.message?.content || "";
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
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "starcoder-"));
  let githubBranch = null;
  let githubPrUrl = null;
  /** @type {"oauth"|"commands"|null} */
  let githubPath = null;
  try {
    const pulled = await pullWorkspace(job);
    for (const f of pulled.files || []) {
      const safe = safeRel(f.path);
      if (!safe) continue;
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

    const hardTask = wantsChialisp(job.prompt);
    const stepLimit = hardTask ? HARD_TASK_STEPS : MAX_STEPS;
    const playbook = hardTask ? await loadPlaybook("chialisp.md") : null;
    if (playbook) log(`[agent] loaded chialisp playbook (${playbook.length} chars)`);
    const agentsMd = await loadRepoAgentsMd(root);
    if (agentsMd) log(`[agent] loaded repo agent instructions`);

    const messages = [
      {
        role: "system",
        content: agentSystem(job, github, githubClone, { playbook, agentsMd }),
      },
    ];
    let finalMessage = "";
    let stepsUsed = 0;

    for (let step = 0; step < stepLimit; step++) {
      stepsUsed = step + 1;
      log(`[agent] step ${step + 1}/${stepLimit} job=${job.id.slice(0, 8)}`);
      let content;
      try {
        content = await ollamaChat(ollamaUrl, model, messages);
      } catch (err) {
        finalMessage = [
          `# Agent error`,
          "",
          err instanceof Error ? err.message : String(err),
          "",
          "## How to run / play",
          "1. Open Studio → Workspace → Download zip if files exist.",
          "2. Retry the job after confirming Ollama is running and the selected model is pulled (`ollama list`).",
        ].join("\n");
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
        break;
      }

      const tool = action.tool;
      const args = action.args || {};
      let observation = "";
      if (tool === "list_files") {
        observation = await toolList(root);
      } else if (tool === "read_file") {
        observation = await toolRead(root, args.path);
      } else if (tool === "write_file") {
        observation = await toolWrite(root, args.path, args.content);
      } else if (tool === "run") {
        observation = await runCommand(root, String(args.command || "true"));
      } else {
        observation = `ERROR: unknown tool ${tool}`;
      }

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
    const verification = verifyWorkspaceFiles(files);
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
          "- Prompt asked for ChiaLisp / .clsp but no `.clsp` file was written.",
        ].join("\n");
      }
    }
    await pushWorkspace(job, files);

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
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
