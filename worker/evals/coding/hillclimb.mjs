#!/usr/bin/env node
/**
 * Coding hillclimb harness:
 *   - Always: replay recorded tool traces against fixtures (offline, CI-safe)
 *   - Optional live: HILLCLIMB_LIVE=1 OLLAMA_URL=… model=… runs a short native-tool loop
 *
 * Run:
 *   node worker/evals/coding/hillclimb.mjs
 *   HILLCLIMB_LIVE=1 OLLAMA_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5-coder:7b node worker/evals/coding/hillclimb.mjs
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { applyStrReplace } from "../../str-replace.mjs";
import { toOllamaTools, firstToolCallAction, mergeToolCalls } from "../../ollama-tools.mjs";
import { CODING_TOOL_SPECS } from "../../tool-specs.mjs";

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
 * Apply a recorded coding tool to a workspace root.
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
  throw new Error(`unsupported replay tool: ${tool}`);
}

async function scoreExpect(root, expect) {
  /** @type {string[]} */
  const fails = [];
  if (expect.filesContain) {
    for (const [rel, needle] of Object.entries(expect.filesContain)) {
      const body = await fs.readFile(path.join(root, rel), "utf8");
      if (!body.includes(String(needle))) {
        fails.push(`${rel} missing ${JSON.stringify(needle)}`);
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
  return fails;
}

async function replayTrace(traceName) {
  const dir = path.join(tracesDir, traceName);
  const workspaceSrc = path.join(dir, "files");
  const trace = await readJson(path.join(dir, "trace.json"));
  const expect = await readJson(path.join(dir, "expect.json"));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `hill-${traceName}-`));
  await copyDir(workspaceSrc, root);
  for (const step of trace.steps || []) {
    await applyTool(root, step);
  }
  const fails = await scoreExpect(root, expect);
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  return { name: traceName, ok: fails.length === 0, fails, mode: "replay" };
}

/**
 * One-shot live: ask Ollama for a single native tool call on the fixture prompt.
 * Scores whether the first tool matches expect.liveTool (optional).
 */
async function liveOneShot(traceName) {
  const dir = path.join(tracesDir, traceName);
  const prompt = await fs.readFile(path.join(dir, "prompt.txt"), "utf8");
  const expect = await readJson(path.join(dir, "expect.json"));
  const ollamaUrl = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
  const model = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
  const tools = toOllamaTools(
    CODING_TOOL_SPECS.filter((t) =>
      ["read_file", "list_files", "str_replace", "write_file", "run"].includes(
        t.name,
      ),
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
            "You are DAT STARCODER. Call exactly one tool to make progress. Prefer str_replace for small edits.",
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
  const calls = mergeToolCalls([], data.message?.tool_calls || []);
  const action = firstToolCallAction(calls);
  /** @type {string[]} */
  const fails = [];
  if (!action) {
    // Fallback: parse JSON tool from content
    const content = String(data.message?.content || "");
    const m = content.match(/"tool"\s*:\s*"(\w+)"/);
    if (!m) fails.push("no native tool_calls and no JSON tool in content");
    else if (expect.liveTool && m[1] !== expect.liveTool) {
      fails.push(`wanted tool ${expect.liveTool}, got ${m[1]}`);
    }
  } else if (expect.liveTool && action.tool !== expect.liveTool) {
    fails.push(`wanted tool ${expect.liveTool}, got ${action.tool}`);
  }
  return {
    name: traceName,
    ok: fails.length === 0,
    fails,
    mode: "live",
    tool: action?.tool || null,
  };
}

async function main() {
  const names = (await fs.readdir(tracesDir)).filter(async () => true);
  const traceNames = [];
  for (const n of await fs.readdir(tracesDir)) {
    if (await pathExists(path.join(tracesDir, n, "trace.json"))) {
      traceNames.push(n);
    }
  }
  assert.ok(traceNames.length > 0, "no traces found");

  let failed = 0;
  for (const name of traceNames) {
    const result = await replayTrace(name);
    if (result.ok) console.log(`ok   replay:${name}`);
    else {
      failed += 1;
      console.error(`FAIL replay:${name} — ${result.fails.join("; ")}`);
    }
  }

  if (process.env.HILLCLIMB_LIVE === "1") {
    for (const name of traceNames) {
      const expect = await readJson(path.join(tracesDir, name, "expect.json"));
      if (!expect.liveTool) continue;
      try {
        const result = await liveOneShot(name);
        if (result.ok) console.log(`ok   live:${name} tool=${result.tool}`);
        else {
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
  console.log("\nhillclimb ok");
}

await main();
