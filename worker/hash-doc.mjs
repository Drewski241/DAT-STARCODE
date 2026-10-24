/**
 * Deterministically document puzzle hashes so 14B agents cannot "forget"
 * to call puzzle_hash / invent 0x placeholders.
 */
import { promises as fs } from "fs";
import path from "path";
import { puzzleHashWithCdv } from "./cdv.mjs";
import { findBarePuzzleHash } from "./verify.mjs";

/**
 * @param {string} docsBody
 * @param {string} bareHash 64 hex chars, no 0x
 */
export function upsertPoolPuzzleHashSection(docsBody, bareHash) {
  const hash = String(bareHash || "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`invalid bare puzzle hash: ${bareHash}`);
  }
  const block = `## Pool puzzle hash\n\n\`${hash}\`\n`;
  const body = String(docsBody || "");
  if (/##\s*Pool puzzle hash\b/i.test(body)) {
    return body.replace(
      /##\s*Pool puzzle hash\s*\n[\s\S]*?(?=\n##\s+\S|$)/i,
      () => block.trimEnd() + "\n",
    );
  }
  return `${body.replace(/\s*$/, "")}\n\n${block}`;
}

/**
 * Prefer puzzles/mtt_pool.clsp, else first .clsp under puzzles/, else any .clsp.
 * @param {string[]} relPaths
 */
export function pickClspForHash(relPaths) {
  const clsp = relPaths.filter((p) => /\.clsp$/i.test(p));
  const preferred = clsp.find((p) => /puzzles\/mtt_pool\.clsp$/i.test(p));
  if (preferred) return preferred;
  const underPuzzles = clsp.find((p) => /(^|\/)puzzles\//i.test(p));
  return underPuzzles || clsp[0] || null;
}

/**
 * Run cdv on the best .clsp and write bare hex into docs/MTT_POOL.md
 * (and optionally RESULT-facing note).
 *
 * @param {string} root
 * @param {{ log?: (msg: string) => void }} [opts]
 * @returns {Promise<{ ok: boolean, path?: string, puzzleHash?: string|null, docsPath?: string, message: string }>}
 */
export async function ensurePuzzleHashDocumented(root, opts = {}) {
  const log = opts.log || (() => {});
  let entries = [];
  try {
    entries = await walkRel(root);
  } catch (err) {
    return {
      ok: false,
      message: `workspace walk failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const clspPath = pickClspForHash(entries);
  if (!clspPath) {
    return { ok: false, message: "no .clsp file to hash" };
  }

  const docsPath = entries.includes("docs/MTT_POOL.md")
    ? "docs/MTT_POOL.md"
    : "docs/MTT_POOL.md";

  let existing = "";
  try {
    existing = await fs.readFile(path.join(root, docsPath), "utf8");
  } catch {
    existing =
      "# MTT pool coin\n\nDocumented by DAT STARCODER after `cdv` puzzle hash.\n";
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
  }

  const already = findBarePuzzleHash(existing);
  if (already) {
    return {
      ok: true,
      path: clspPath,
      puzzleHash: already,
      docsPath,
      message: `docs already have bare puzzle hash ${already}`,
    };
  }

  const result = await puzzleHashWithCdv(root, clspPath, {});
  if (!result.puzzleHash) {
    log(`[hash-doc] cdv did not return a hash for ${clspPath}: ${result.message}`);
    return {
      ok: false,
      path: clspPath,
      puzzleHash: null,
      docsPath,
      message: result.message || "cdv returned no puzzle hash",
    };
  }

  const next = upsertPoolPuzzleHashSection(existing, result.puzzleHash);
  await fs.writeFile(path.join(root, docsPath), next, "utf8");
  log(`[hash-doc] wrote ${result.puzzleHash} into ${docsPath}`);
  return {
    ok: true,
    path: clspPath,
    puzzleHash: result.puzzleHash,
    docsPath,
    message: `documented puzzle hash ${result.puzzleHash}`,
  };
}

async function walkRel(root) {
  const out = [];
  async function walk(dir, prefix) {
    const names = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of names) {
      if (ent.name === ".git" || ent.name === "node_modules") continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) await walk(path.join(dir, ent.name), rel);
      else out.push(rel);
    }
  }
  await walk(root, "");
  return out;
}
