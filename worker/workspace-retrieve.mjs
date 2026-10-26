/**
 * Repo-scale retrieval over the workspace (rg when available, JS fallback).
 */
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".datstarcoder",
]);

/**
 * @param {string} root
 * @param {string} query
 * @param {{ maxHits?: number, glob?: string }} [opts]
 * @returns {Promise<{ ok: boolean, engine: string, hits: { path: string, line: number, text: string }[], message: string }>}
 */
export async function searchWorkspace(root, query, opts = {}) {
  const q = String(query || "").trim();
  if (!q || q.length < 2) {
    return { ok: false, engine: "none", hits: [], message: "query too short" };
  }
  const maxHits = opts.maxHits ?? 40;

  const rg = await tryRipgrep(root, q, maxHits, opts.glob);
  if (rg) return rg;

  const hits = await jsScan(root, q, maxHits);
  return {
    ok: true,
    engine: "js",
    hits,
    message: `js scan · ${hits.length} hit(s)`,
  };
}

/**
 * @param {string} root
 * @param {string} q
 * @param {number} maxHits
 * @param {string} [glob]
 */
function tryRipgrep(root, q, maxHits, glob) {
  return new Promise((resolve) => {
    const args = [
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "--max-count",
      "8",
      "-i",
      q,
      ".",
    ];
    if (glob) args.unshift("--glob", glob);
    const child = spawn("rg", args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 8_000);
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // rg exits 1 when no matches
      if (code !== 0 && code !== 1) {
        resolve(null);
        return;
      }
      /** @type {{ path: string, line: number, text: string }[]} */
      const hits = [];
      for (const line of out.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = line.match(/^([^:]+):(\d+):(.*)$/);
        if (!m) continue;
        hits.push({
          path: m[1].replace(/^\.\//, ""),
          line: Number(m[2]),
          text: m[3].slice(0, 240),
        });
        if (hits.length >= maxHits) break;
      }
      resolve({
        ok: true,
        engine: "rg",
        hits,
        message: `rg · ${hits.length} hit(s)${err.trim() ? ` · ${err.trim().slice(0, 120)}` : ""}`,
      });
    });
  });
}

/**
 * @param {string} root
 * @param {string} q
 * @param {number} maxHits
 */
async function jsScan(root, q, maxHits) {
  /** @type {{ path: string, line: number, text: string }[]} */
  const hits = [];
  const needle = q.toLowerCase();

  async function walk(dir) {
    if (hits.length >= maxHits) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= maxHits) return;
      if (e.name.startsWith(".") && e.name !== ".env.example") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name)) continue;
        await walk(full);
        continue;
      }
      if (!/\.(md|txt|ts|tsx|js|jsx|mjs|cjs|json|css|html|clsp|yml|yaml)$/i.test(e.name)) {
        continue;
      }
      let body;
      try {
        const buf = await fs.readFile(full);
        if (buf.length > 200_000) continue;
        body = buf.toString("utf8");
      } catch {
        continue;
      }
      const rel = path.relative(root, full).replace(/\\/g, "/");
      const lines = body.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push({
            path: rel,
            line: i + 1,
            text: lines[i].slice(0, 240),
          });
          if (hits.length >= maxHits) return;
        }
      }
    }
  }

  await walk(root);
  return hits;
}

/**
 * Rank paths for the model from a search result + optional touch list.
 * @param {{ path: string }[]} hits
 * @param {string[]} [filesTouched]
 */
export function rankSearchPaths(hits, filesTouched = []) {
  const touched = new Set(filesTouched);
  const scores = new Map();
  for (const h of hits) {
    const p = h.path;
    scores.set(p, (scores.get(p) || 0) + 1 + (touched.has(p) ? 5 : 0));
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
}
