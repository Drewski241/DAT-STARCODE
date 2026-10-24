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
    // Curry: AUTHORIZER_PK TREASURY_PH OWNER_PH
    return [DEMO_PK, DEMO_PH, DEMO_OWNER];
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

  // Prefer workspace include/ (seeded sha256tree.clib) then template include/.
  const includeFlags = [];
  for (const inc of ["include", "templates/secure-treasury/include"]) {
    try {
      await fs.access(path.join(root, inc));
      includeFlags.push("-i", inc);
    } catch {
      /* missing */
    }
  }

  const hexPath = `${safe}.hex`;
  const curriedHexCandidates = [
    hexPath.replace(/\.hex$/i, ".curried.hex"),
    `${hexPath}.curried`,
  ];
  // Drop stale hex from prior turns so we never hash/curry an old program
  // after the .clsp was rescued/overwritten (Studio zip 199278a5).
  for (const rel of [hexPath, ...curriedHexCandidates]) {
    try {
      await fs.unlink(path.join(root, rel));
    } catch {
      /* missing */
    }
  }

  const buildStarted = Date.now();
  const build = await run("cdv", ["clsp", "build", safe, ...includeFlags], {
    cwd: root,
    timeoutMs: 90_000,
  });
  let hexBody = "";
  try {
    hexBody = (await fs.readFile(path.join(root, hexPath), "utf8"))
      .replace(/\s+/g, "")
      .trim();
  } catch {
    /* build may write elsewhere */
  }
  if (build.code !== 0 || !hexBody) {
    return {
      ok: false,
      available: true,
      path: safe,
      hexPath: null,
      puzzleHash: null,
      modHash: null,
      curried: false,
      curryArgs: null,
      buildCode: build.code,
      message: `cdv build failed (code ${build.code}): ${(build.stderr || build.stdout).slice(0, 500)}`,
      log: `${build.stdout}\n${build.stderr}`.slice(0, 4000),
    };
  }

  let curryArgs = Array.isArray(opts.curryArgs) ? opts.curryArgs.map(String) : [];
  let curryOut = "";
  let hashLine = "";
  let modHash = null;
  let curried = false;

  // Uncurried / mod hash first.
  const inspectCmds = [
    ["inspect", "puzzle", hexPath],
    ["inspect", "puzzle", "-x", hexPath],
    ["clsp", "hash", safe],
  ];
  const inspectBlobs = [];
  for (const args of inspectCmds) {
    const inspect = await run("cdv", args, { cwd: root, timeoutMs: 60_000 });
    inspectBlobs.push(inspect.stdout, inspect.stderr);
    hashLine =
      extractPuzzleHash(`${inspect.stdout}\n${inspect.stderr}`, {
        labeledOnly: false,
      }) || hashLine;
    if (hashLine) break;
  }
  modHash = hashLine;

  if (!curryArgs.length && !opts.skipAutoCurry && modHash) {
    const inferred = defaultCurryArgsFor(safe, modHash);
    if (inferred) curryArgs = inferred;
  }

  if (curryArgs.length && hexBody) {
    const curryStarted = Date.now();
    const curry = await run(
      "cdv",
      ["clsp", "curry", hexPath, ...curryArgs.flatMap((a) => ["-a", a])],
      { cwd: root, timeoutMs: 90_000 },
    );
    curryOut = `${curry.stdout}\n${curry.stderr}`.trim();
    const curriedHash = extractPuzzleHash(curryOut, { labeledOnly: true });
    if (curriedHash) {
      hashLine = curriedHash;
      curried = true;
    }
    // Only trust curried hex written during this curry (not a prior turn).
    for (const cand of curriedHexCandidates) {
      try {
        const st = await fs.stat(path.join(root, cand));
        if (st.mtimeMs + 1000 < curryStarted && st.mtimeMs + 1000 < buildStarted) {
          continue;
        }
        const insp = await run("cdv", ["inspect", "puzzle", cand], {
          cwd: root,
          timeoutMs: 60_000,
        });
        inspectBlobs.push(insp.stdout, insp.stderr);
        const h = extractPuzzleHash(`${insp.stdout}\n${insp.stderr}`, {
          labeledOnly: false,
        });
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
  if (!hashLine) {
    hashLine = extractPuzzleHash(blob, { labeledOnly: true }) || "";
  }

  const ok = Boolean(hashLine);
  return {
    ok,
    available: true,
    path: safe,
    hexPath,
    puzzleHash: hashLine || null,
    modHash: modHash || null,
    curried,
    curryArgs: curryArgs.length ? curryArgs : null,
    buildCode: build.code,
    message: ok
      ? `puzzle hash: ${hashLine}${curried ? " (curried)" : " (uncurried mod)"}`
      : `cdv build ok but hash not parsed — check cdv inspect/curry output.`,
    log: blob.slice(0, 4000),
  };
}

/** Demo / placeholder 64-hex (all same nibble) — never a real puzzle hash. */
function isPlaceholderHash(h) {
  return /^([0-9a-f])\1{63}$/i.test(String(h || ""));
}

/**
 * Prefer labeled puzzle-hash lines over arbitrary 64-hex (curry -a args, etc.).
 * @param {string} text
 * @param {{ labeledOnly?: boolean }} [opts]
 */
export function extractPuzzleHash(text, opts = {}) {
  const s = String(text || "");
  const labeled = s.match(
    /(?:puzzle\s*hash|treehash|ph)\s*[:=]?\s*(?:0x)?([0-9a-fA-F]{64})\b/i,
  );
  if (labeled && !isPlaceholderHash(labeled[1])) {
    return labeled[1].toLowerCase();
  }
  if (opts.labeledOnly) return null;
  for (const m of s.matchAll(/\b(?:0x)?([0-9a-fA-F]{64})\b/g)) {
    if (!isPlaceholderHash(m[1])) return m[1].toLowerCase();
  }
  return null;
}
