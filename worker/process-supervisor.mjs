/**
 * Background process supervisor for coding turns (dev servers, long installs).
 * Keeps logs on disk; keyed by workspace root + name.
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createWriteStream } from "fs";

/** @type {Map<string, { child: import('child_process').ChildProcess, logPath: string, cmd: string, startedAt: string, cwd: string, exitCode: number|null }>} */
const PROCS = new Map();

function keyFor(root, name) {
  return `${path.resolve(root)}::${String(name || "default")}`;
}

function logDirFor(root) {
  const safe = path
    .basename(path.resolve(root))
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 48);
  return path.join(os.tmpdir(), "datstarcoder-bg", safe || "ws");
}

/**
 * Commands allowed to run detached (dev servers / static servers).
 * @param {string} command
 */
export function isAllowedServerCommand(command) {
  const cmd = String(command || "").trim();
  if (!cmd || cmd.length > 240) return false;
  if (/[;&|`$<>]/.test(cmd) && !/\bnpm\s+run\b/.test(cmd)) {
    // allow npm run foo -- --port=3000 style without shell metachar abuse
    if (/[;&|`$]/.test(cmd)) return false;
  }
  if (
    /\b(sudo|pkexec|passwd|su\b|visudo|shutdown|reboot|halt|poweroff|xdg-open|gio\s+open)\b/i.test(
      cmd,
    )
  ) {
    return false;
  }
  return /^(npm\s+run\s+(dev|start|preview)\b|npx\s+(next|vite|serve)\b|next\s+dev\b|node\s+[\w./-]+\.m?js\b|python3?\s+-m\s+http\.server\b|npx\s+http-server\b)/i.test(
    cmd,
  );
}

/**
 * @param {string} root
 * @param {{ name?: string, command: string, env?: Record<string,string> }} opts
 */
export async function startBackground(root, opts) {
  const name = String(opts?.name || "default").slice(0, 40) || "default";
  const command = String(opts?.command || "").trim();
  if (!isAllowedServerCommand(command)) {
    return {
      ok: false,
      message:
        "Command not allowed for start_server. Use npm run dev|start|preview, next/vite/serve, node server.js, or python -m http.server.",
    };
  }
  const key = keyFor(root, name);
  const existing = PROCS.get(key);
  if (existing && existing.exitCode == null && !existing.child.killed) {
    return {
      ok: true,
      alreadyRunning: true,
      name,
      pid: existing.child.pid,
      logPath: existing.logPath,
      command: existing.cmd,
      message: `already running pid=${existing.child.pid} — use server_logs or stop_server`,
    };
  }

  const dir = logDirFor(root);
  await fs.mkdir(dir, { recursive: true });
  const logPath = path.join(dir, `${name}.log`);
  await fs.writeFile(logPath, "", "utf8");
  const out = createWriteStream(logPath, { flags: "a" });

  const child = spawn(command, {
    cwd: root,
    shell: true,
    env: {
      ...process.env,
      ...(opts.env || {}),
      CI: "1",
      BROWSER: "none",
      FORCE_COLOR: "0",
      npm_config_fund: "false",
      npm_config_audit: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
    // New process group so stop can signal the whole tree (npm → node).
    detached: true,
  });

  const rec = {
    child,
    logPath,
    cmd: command,
    startedAt: new Date().toISOString(),
    cwd: root,
    exitCode: /** @type {number|null} */ (null),
  };
  PROCS.set(key, rec);

  child.stdout?.on("data", (d) => out.write(d));
  child.stderr?.on("data", (d) => out.write(d));
  child.on("close", (code) => {
    rec.exitCode = code ?? 0;
    try {
      out.write(`\n[exit ${rec.exitCode}]\n`);
      out.end();
    } catch {
      /* ignore */
    }
  });

  // Brief settle so first listen line often appears in logs.
  await new Promise((r) => setTimeout(r, 800));
  const snippet = await readLogTail(logPath, 40);

  return {
    ok: true,
    name,
    pid: child.pid,
    logPath,
    command,
    message: `started pid=${child.pid}`,
    logTail: snippet,
  };
}

function killTree(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} root
 * @param {string} [name]
 */
export async function stopBackground(root, name = "default") {
  const key = keyFor(root, name);
  const rec = PROCS.get(key);
  if (!rec) {
    return { ok: true, message: `no process named ${name}` };
  }
  try {
    killTree(rec.child);
    await new Promise((r) => setTimeout(r, 400));
    if (rec.exitCode == null) {
      try {
        process.kill(-rec.child.pid, "SIGKILL");
      } catch {
        try {
          rec.child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  PROCS.delete(key);
  return { ok: true, message: `stopped ${name}`, logPath: rec.logPath };
}

/**
 * @param {string} root
 */
export async function stopAllBackground(root) {
  const prefix = `${path.resolve(root)}::`;
  const names = [];
  for (const key of [...PROCS.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const name = key.slice(prefix.length);
    await stopBackground(root, name);
    names.push(name);
  }
  return { ok: true, stopped: names };
}

async function readLogTail(logPath, lines = 80) {
  try {
    const text = await fs.readFile(logPath, "utf8");
    const parts = text.split(/\r?\n/);
    return parts.slice(Math.max(0, parts.length - lines)).join("\n");
  } catch {
    return "";
  }
}

/**
 * @param {string} root
 * @param {{ name?: string, lines?: number }} [opts]
 */
export async function serverLogs(root, opts = {}) {
  const name = String(opts.name || "default");
  const key = keyFor(root, name);
  const rec = PROCS.get(key);
  if (!rec) {
    return { ok: false, message: `no process named ${name}` };
  }
  const tail = await readLogTail(rec.logPath, opts.lines ?? 80);
  return {
    ok: true,
    name,
    pid: rec.child.pid,
    running: rec.exitCode == null,
    exitCode: rec.exitCode,
    command: rec.cmd,
    logPath: rec.logPath,
    logTail: tail,
  };
}
