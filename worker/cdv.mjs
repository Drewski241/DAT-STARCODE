/**
 * Optional Chia Dev Tools (cdv) integration for the worker.
 * Soft-fails when cdv is not installed.
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        code: 124,
        stdout,
        stderr: `${stderr}\nERROR: timed out`,
      });
    }, opts.timeoutMs || 60_000);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

let cachedAvailable = null;

/** @returns {Promise<boolean>} */
export async function cdvAvailable() {
  if (cachedAvailable != null) return cachedAvailable;
  const which = await run("which", ["cdv"], { timeoutMs: 5_000 });
  if (which.code === 0 && which.stdout.trim()) {
    cachedAvailable = true;
    return true;
  }
  const help = await run("cdv", ["--help"], { timeoutMs: 8_000 });
  cachedAvailable = help.code === 0;
  return cachedAvailable;
}

/**
 * Build a .clsp and try to surface a puzzle hash / hex.
 * @param {string} root workspace root
 * @param {string} relPath e.g. puzzles/mtt_pool.clsp
 * @param {{ curryArgs?: string[] }} [opts]
 */
export async function puzzleHashWithCdv(root, relPath, opts = {}) {
  const available = await cdvAvailable();
  if (!available) {
    return {
      ok: false,
      available: false,
      message:
        "cdv not found on this worker. Install chia-dev-tools (pipx install chia-dev-tools) and restart the worker.",
    };
  }

  const safe = String(relPath || "").replace(/^\/+/, "");
  if (!safe || safe.includes("..") || !/\.clsp$/i.test(safe)) {
    return { ok: false, available: true, message: "path must be a relative .clsp file" };
  }
  const full = path.join(root, safe);
  try {
    await fs.access(full);
  } catch {
    return { ok: false, available: true, message: `file not found: ${safe}` };
  }

  const build = await run("cdv", ["clsp", "build", safe], {
    cwd: root,
    timeoutMs: 90_000,
  });
  const hexPath = `${safe}.hex`;
  let hexBody = "";
  try {
    hexBody = (await fs.readFile(path.join(root, hexPath), "utf8")).trim();
  } catch {
    /* build may write elsewhere */
  }

  const curryArgs = Array.isArray(opts.curryArgs) ? opts.curryArgs.map(String) : [];
  let curryOut = "";
  let hashLine = "";

  if (curryArgs.length && hexBody) {
    const curry = await run(
      "cdv",
      ["clsp", "curry", hexPath, ...curryArgs.flatMap((a) => ["-a", a])],
      { cwd: root, timeoutMs: 90_000 },
    );
    curryOut = `${curry.stdout}\n${curry.stderr}`.trim();
  }

  // Try inspect / hash helpers when present (CLI shapes vary by chia-dev-tools version).
  const inspectTarget = hexBody ? hexPath : safe;
  const inspectCmds = [
    ["inspect", "puzzle", inspectTarget],
    ["inspect", "puzzle", "-x", inspectTarget],
    ["clsp", "hash", safe],
    ["hash", inspectTarget],
  ];
  const inspectBlobs = [];
  for (const args of inspectCmds) {
    const inspect = await run("cdv", args, { cwd: root, timeoutMs: 60_000 });
    inspectBlobs.push(inspect.stdout, inspect.stderr);
    hashLine = extractPuzzleHash(`${inspect.stdout}\n${inspect.stderr}`) || hashLine;
    if (hashLine) break;
  }

  const blob = [build.stdout, build.stderr, curryOut, ...inspectBlobs]
    .filter(Boolean)
    .join("\n");
  if (!hashLine) hashLine = extractPuzzleHash(blob) || "";

  // Fallback: sha256 of hex file bytes is NOT the puzzle hash — only report cdv hashes.
  const ok = build.code === 0 || Boolean(hexBody) || Boolean(hashLine);
  return {
    ok,
    available: true,
    path: safe,
    hexPath: hexBody ? hexPath : null,
    puzzleHash: hashLine || null,
    buildCode: build.code,
    message: ok
      ? hashLine
        ? `puzzle hash: ${hashLine}`
        : `cdv build finished (code ${build.code}). Hex: ${hexBody ? hexPath : "n/a"}. Hash not parsed — check cdv inspect output.`
      : `cdv failed (build ${build.code}): ${(build.stderr || build.stdout).slice(0, 500)}`,
    log: blob.slice(0, 4000),
  };
}

/** Prefer labeled puzzle-hash lines over arbitrary 64-hex (e.g. pubkeys in logs). */
export function extractPuzzleHash(text) {
  const s = String(text || "");
  const labeled = s.match(
    /(?:puzzle\s*hash|treehash|ph)\s*[:=]?\s*(?:0x)?([0-9a-fA-F]{64})\b/i,
  );
  if (labeled) return labeled[1].toLowerCase();
  const m = s.match(/\b([0-9a-fA-F]{64})\b/);
  return m ? m[1].toLowerCase() : null;
}
