/**
 * Chia Dev Tools (cdv) integration for the worker.
 * puzzleHashWithCdv returns available:false when cdv is missing; hard-domain
 * jobs treat that as a verification failure via worker/tooling.mjs.
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

/** Demo 32-byte atoms for educational curry (not mainnet keys). */
const DEMO_PK =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const DEMO_PH =
  "0x3333333333333333333333333333333333333333333333333333333333333333";
const DEMO_OWNER =
  "0x4444444444444444444444444444444444444444444444444444444444444444";

/**
 * After the uncurried mod hash is known, build curry -a values for known templates.
 * MOD_HASH is injected as the first curry arg for vault/treasury recreation puzzles.
 * @param {string} relPath
 * @param {string} modHash bare 64-hex
 * @returns {string[]|null}
 */
export function defaultCurryArgsFor(relPath, modHash) {
  const p = String(relPath || "");
  const mod = String(modHash || "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(mod)) return null;
  const mod0x = `0x${mod.toLowerCase()}`;
  if (/puzzles\/savings_vault\.clsp$/i.test(p)) {
    // Curry: MOD_HASH AUTHORIZER_PK MIN_HOLD INTEREST_BPS TREASURY_PH PRINCIPAL DEPOSIT OWNER
    return [mod0x, DEMO_PK, "86400", "500", DEMO_PH, "1000000", "1700000000", DEMO_OWNER];
  }
  if (/puzzles\/treasury_coin\.clsp$/i.test(p)) {
    return [mod0x, DEMO_PK];
  }
  if (/puzzles\/interest_payout\.clsp$/i.test(p)) {
    return [DEMO_PK, DEMO_PH];
  }
  if (/puzzles\/mtt_pool\.clsp$/i.test(p)) {
    // BUY_IN MAX SPLIT_1 SPLIT_2 SPLIT_3 AUTHORIZER_PK POOL_PUZZLE_HASH
    return ["1000000000", "9", "50", "30", "20", DEMO_PK, mod0x];
  }
  return null;
}

/**
 * Build a .clsp and try to surface a puzzle hash / hex.
 * When curryArgs omitted, known templates get a two-phase hash: uncurried mod →
 * curry with defaultCurryArgsFor(modHash) → curried puzzle hash.
 * @param {string} root workspace root
 * @param {string} relPath e.g. puzzles/mtt_pool.clsp
 * @param {{ curryArgs?: string[], skipAutoCurry?: boolean }} [opts]
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

  let curryArgs = Array.isArray(opts.curryArgs) ? opts.curryArgs.map(String) : [];
  let curryOut = "";
  let hashLine = "";
  let modHash = null;
  let curried = false;

  // Uncurried / mod hash first.
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
  modHash = hashLine;

  if (!curryArgs.length && !opts.skipAutoCurry && modHash) {
    const inferred = defaultCurryArgsFor(safe, modHash);
    if (inferred) curryArgs = inferred;
  }

  if (curryArgs.length && hexBody) {
    const curry = await run(
      "cdv",
      ["clsp", "curry", hexPath, ...curryArgs.flatMap((a) => ["-a", a])],
      { cwd: root, timeoutMs: 90_000 },
    );
    curryOut = `${curry.stdout}\n${curry.stderr}`.trim();
    const curriedHash = extractPuzzleHash(curryOut);
    if (curriedHash) {
      hashLine = curriedHash;
      curried = true;
    }
    // Some cdv versions write a curried hex — prefer hashing that if present.
    const curriedHexCandidates = [
      hexPath.replace(/\.hex$/i, ".curried.hex"),
      `${hexPath}.curried`,
    ];
    for (const cand of curriedHexCandidates) {
      try {
        await fs.access(path.join(root, cand));
        const insp = await run("cdv", ["inspect", "puzzle", cand], {
          cwd: root,
          timeoutMs: 60_000,
        });
        inspectBlobs.push(insp.stdout, insp.stderr);
        const h = extractPuzzleHash(`${insp.stdout}\n${insp.stderr}`);
        if (h) {
          hashLine = h;
          curried = true;
          break;
        }
      } catch {
        /* ignore */
      }
    }
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
    modHash: modHash || null,
    curried,
    curryArgs: curryArgs.length ? curryArgs : null,
    buildCode: build.code,
    message: ok
      ? hashLine
        ? `puzzle hash: ${hashLine}${curried ? " (curried)" : " (uncurried mod)"}`
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
