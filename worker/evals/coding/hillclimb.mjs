#!/usr/bin/env node
/**
 * Coding hillclimb harness (offline + optional live):
 *   - replay: apply golden tool traces to fixtures
 *   - repair: score action-normalize against real bad assistant outputs
 *   - memory: offline check that checkpoint Q detection + format fields exist
 *   - live (HILLCLIMB_LIVE=1): one Ollama tool call; normalize/repair before scoring
 *
 * Run:
 *   node worker/evals/coding/hillclimb.mjs
 *   HILLCLIMB_LIVE=1 OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5-coder:7b \
 *     node worker/evals/coding/hillclimb.mjs
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { applyStrReplace } from "../../str-replace.mjs";
import {
  toOllamaTools,
  firstToolCallAction,
  mergeToolCalls,
} from "../../ollama-tools.mjs";
import { CODING_TOOL_SPECS } from "../../tool-specs.mjs";
import {
  normalizeAgentAction,
  isCheckpointQuestion,
} from "../../action-normalize.mjs";
import { formatCheckpointForPrompt } from "../../project-memory.mjs";
import { captureScreenshot, loadPlaywright } from "../../screenshot.mjs";
import { searchWorkspace } from "../../workspace-retrieve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tracesDir = path.join(here, "traces");

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === ".keep") continue;
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

/**
 * @param {string} root
 * @param {{ tool: string, args?: Record<string, unknown> }} step
 */
async function applyTool(root, step) {
  const tool = String(step.tool || "");
  const args = step.args || {};
  if (tool === "str_replace") {
    const rel = String(args.path || "");
    const full = path.join(root, rel);
    const body = await fs.readFile(full, "utf8");
    const result = applyStrReplace(body, {
      oldText: String(args.oldText || ""),
      newText: String(args.newText || ""),
      replaceAll: Boolean(args.replaceAll),
    });
    if (!result.ok) throw new Error(result.message);
    await fs.writeFile(full, result.content, "utf8");
    return { ok: true, tool };
  }
  if (tool === "write_file") {
    const rel = String(args.path || "");
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, String(args.content ?? ""), "utf8");
    return { ok: true, tool };
  }
  if (tool === "read_file" || tool === "list_files") {
    return { ok: true, tool, skipped: true };
  }
  if (tool === "search_files") {
    const result = await searchWorkspace(root, String(args.query || ""));
    return { ok: true, tool, hits: result.hits?.length || 0 };
  }
  if (tool === "screenshot_url") {
    const shot = await captureScreenshot(root, {
      url: args.url || args.path || "index.html",
      path: args.path,
      name: args.name || "preview",
    });
    if (!shot.ok) {
      const msg = String(shot.message || "screenshot failed");
      // Soft-skip when Chromium/Playwright isn't on the box — still run other traces.
      if (/Playwright not installed/i.test(msg)) {
        return { ok: true, tool, skipped: true, skipReason: msg };
      }
      throw new Error(msg);
    }
    return { ok: true, tool };
  }
  throw new Error(`unsupported replay tool: ${tool}`);
}

async function scoreExpect(root, expect) {
  /** @type {string[]} */
  const fails = [];
  if (expect.filesContain) {
    for (const [rel, needle] of Object.entries(expect.filesContain)) {
      try {
        const body = await fs.readFile(path.join(root, rel), "utf8");
        if (!body.includes(String(needle))) {
          fails.push(`${rel} missing ${JSON.stringify(needle)}`);
        }
      } catch {
        fails.push(`${rel} missing file`);
      }
    }
  }
  if (expect.filesNotContain) {
    for (const [rel, needle] of Object.entries(expect.filesNotContain)) {
      const body = await fs.readFile(path.join(root, rel), "utf8");
      if (body.includes(String(needle))) {
        fails.push(`${rel} still contains ${JSON.stringify(needle)}`);
      }
    }
  }
  if (expect.filesExist) {
    for (const rel of expect.filesExist) {
      if (!(await pathExists(path.join(root, rel)))) {
        fails.push(`missing path ${rel}`);
      }
    }
  }
  return fails;
}

async function replayTrace(traceName) {
  const dir = path.join(tracesDir, traceName);
  const trace = await readJson(path.join(dir, "trace.json"));
  const expect = await readJson(path.join(dir, "expect.json"));

  if (expect.mode === "repair" || trace.mode === "repair") {
    /** @type {string[]} */
    const fails = [];
    for (const [i, case_] of (expect.repairs || []).entries()) {
      const normalized = normalizeAgentAction(
        case_.rawAction,
        case_.assistantText || "",
      );
      const got = normalized.ok ? normalized.action?.tool : null;
      if (got !== case_.wantTool) {
        fails.push(
          `repair[${i}] want ${case_.wantTool} got ${got} (${normalized.reason || "ok"})`,
        );
      }
    }
    return {
      name: traceName,
      ok: fails.length === 0,
      fails,
      mode: "repair",
    };
  }

  if (expect.mode === "memory" || trace.mode === "memory") {
    const prompt = await fs.readFile(path.join(dir, "prompt.txt"), "utf8");
    /** @type {string[]} */
    const fails = [];
    if (!isCheckpointQuestion(prompt)) {
      fails.push("prompt not detected as checkpoint question");
    }
    const cpPath = path.join(dir, "files", ".datstarcoder", "checkpoint.json");
    const cp = await readJson(cpPath);
    const formatted = formatCheckpointForPrompt(cp);
    for (const pat of expect.mustMatch || []) {
      if (!new RegExp(pat, "i").test(formatted)) {
        fails.push(`checkpoint format missing /${pat}/`);
      }
    }
    return {
      name: traceName,
      ok: fails.length === 0,
      fails,
      mode: "memory",
    };
  }

  const workspaceSrc = path.join(dir, "files");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `hill-${traceName}-`));
  await copyDir(workspaceSrc, root);
  try {
    /** @type {string|null} */
    let skipReason = null;
    for (const step of trace.steps || []) {
      const applied = await applyTool(root, step);
      if (applied?.skipped && applied.skipReason) {
        skipReason = String(applied.skipReason);
      }
    }
    if (skipReason) {
      return {
        name: traceName,
        ok: true,
        fails: [],
        mode: "replay-skip",
        skipReason,
      };
    }
    const fails = await scoreExpect(root, expect);
    return { name: traceName, ok: fails.length === 0, fails, mode: "replay" };
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Live one-shot with normalize/repair (matches production agent path).
 */
async function liveOneShot(traceName) {
  const dir = path.join(tracesDir, traceName);
  const prompt = await fs.readFile(path.join(dir, "prompt.txt"), "utf8");
  const expect = await readJson(path.join(dir, "expect.json"));
  if (expect.mode === "repair" || expect.mode === "memory") {
    return { name: traceName, ok: true, fails: [], mode: "live-skip" };
  }
  const ollamaUrl = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
  const model = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
  const tools = toOllamaTools(
    CODING_TOOL_SPECS.filter((t) =>
      [
        "read_file",
        "list_files",
        "search_files",
        "str_replace",
        "write_file",
        "screenshot_url",
        "run",
      ].includes(t.name),
    ),
  );

  const files = await fs.readdir(path.join(dir, "files"));
  const listing = files.join("\n");
  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      tools,
      messages: [
        {
          role: "system",
          content:
            "You are DAT STARCODER. Call exactly one tool to make progress. " +
            "Prefer str_replace for small edits, write_file for new files, " +
            "search_files before editing unfamiliar code, screenshot_url for index.html. " +
            'Never emit tool name undefined. JSON fallback: {"tool":"...","args":{...}}',
        },
        {
          role: "user",
          content: `${prompt.trim()}\n\nWorkspace files:\n${listing}\n`,
        },
      ],
      options: { temperature: 0.1, num_ctx: 8192 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return {
      name: traceName,
      ok: false,
      fails: [`ollama ${res.status}: ${body.slice(0, 200)}`],
      mode: "live",
    };
  }
  const data = await res.json();
  const content = String(data.message?.content || "");
  const calls = mergeToolCalls([], data.message?.tool_calls || []);
  let native = firstToolCallAction(calls);
  if (native && !native.tool) native = null;
  const raw = native
    ? { tool: native.tool, args: native.args }
    : (() => {
        try {
          const start = content.indexOf("{");
          const end = content.lastIndexOf("}");
          if (start >= 0 && end > start) {
            return JSON.parse(content.slice(start, end + 1));
          }
        } catch {
          /* ignore */
        }
        return null;
      })();
  const normalized = normalizeAgentAction(raw, content);
  /** @type {string[]} */
  const fails = [];
  if (!normalized.ok || !normalized.action?.tool) {
    fails.push(
      `no usable tool after normalize (${normalized.reason || "unparsed"}); content=${content.slice(0, 120)}`,
    );
  } else if (expect.liveTool && normalized.action.tool !== expect.liveTool) {
    fails.push(
      `wanted tool ${expect.liveTool}, got ${normalized.action.tool}`,
    );
  }
  if (
    expect.liveArgsPath &&
    normalized.action?.args &&
    String(normalized.action.args.path || "") !== expect.liveArgsPath
  ) {
    // Soft: first tool may be read/list; only fail if write_file with wrong path
    if (normalized.action.tool === "write_file") {
      fails.push(
        `wanted path ${expect.liveArgsPath}, got ${normalized.action.args.path}`,
      );
    }
  }
  return {
    name: traceName,
    ok: fails.length === 0,
    fails,
    mode: "live",
    tool: normalized.action?.tool || null,
    repaired: Boolean(normalized.repaired),
  };
}

async function main() {
  const traceNames = [];
  for (const n of await fs.readdir(tracesDir)) {
    if (await pathExists(path.join(tracesDir, n, "trace.json"))) {
      traceNames.push(n);
    }
  }
  assert.ok(traceNames.length > 0, "no traces found");
  traceNames.sort();

  let failed = 0;
  for (const name of traceNames) {
    const result = await replayTrace(name);
    if (result.ok && result.mode === "replay-skip") {
      console.log(
        `skip ${name} — ${result.skipReason || "optional dependency missing"}`,
      );
    } else if (result.ok) console.log(`ok   ${result.mode}:${name}`);
    else {
      failed += 1;
      console.error(`FAIL ${result.mode}:${name} — ${result.fails.join("; ")}`);
    }
  }

  if (process.env.HILLCLIMB_LIVE === "1") {
    const pw = await loadPlaywright();
    for (const name of traceNames) {
      const expect = await readJson(path.join(tracesDir, name, "expect.json"));
      if (!expect.liveTool) continue;
      if (expect.liveTool === "screenshot_url" && !pw) {
        console.log(
          `skip live:${name} — Playwright not installed (npm i -D playwright && npx playwright install chromium)`,
        );
        continue;
      }
      try {
        const result = await liveOneShot(name);
        if (result.mode === "live-skip") continue;
        if (result.ok) {
          console.log(
            `ok   live:${name} tool=${result.tool}${result.repaired ? " (repaired)" : ""}`,
          );
        } else {
          failed += 1;
          console.error(`FAIL live:${name} — ${result.fails.join("; ")}`);
        }
      } catch (err) {
        failed += 1;
        console.error(
          `FAIL live:${name} — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } else {
    console.log("skip live hillclimb (set HILLCLIMB_LIVE=1 to enable)");
  }

  if (failed) {
    console.error(`\n${failed} hillclimb case(s) failed`);
    process.exit(1);
  }
  console.log(`\nhillclimb ok (${traceNames.length} traces)`);
}

await main();
