/**
 * Tool implementations for the DAT STARCODER agent loop.
 *
 * Env:
 *   AGENT_REPO_ROOT   root for read_file / list_dir (default: cwd)
 *   AGENT_ALLOW_SHELL set to 1 to enable run_command (still allowlisted)
 */

import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(
  process.env.AGENT_REPO_ROOT || process.cwd(),
);
const ALLOW_SHELL = process.env.AGENT_ALLOW_SHELL === "1";
const MAX_FETCH_BYTES = 80_000;
const MAX_FILE_BYTES = 60_000;

const SHELL_ALLOW =
  /^(ls|pwd|uname|cat|head|tail|wc|df|du|ss|ip|which|type|echo|date|whoami|id|lsb_release|systemctl|journalctl|apt|apt-get|dpkg|git|node|npm|npx|python3|chia|cdv|clvm)\b/;

function resolveSafe(rel) {
  const target = path.resolve(REPO_ROOT, rel || ".");
  if (
    target !== REPO_ROOT &&
    !target.startsWith(REPO_ROOT + path.sep)
  ) {
    throw new Error("Path escapes AGENT_REPO_ROOT");
  }
  return target;
}

export const TOOL_SPECS = [
  {
    name: "web_search",
    description: "Search the public web for docs, errors, OS how-tos",
    args: { query: "string" },
  },
  {
    name: "fetch_url",
    description: "Fetch a URL and return truncated text content",
    args: { url: "string" },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 file under AGENT_REPO_ROOT",
    args: { path: "string" },
  },
  {
    name: "list_dir",
    description: "List files in a directory under AGENT_REPO_ROOT",
    args: { path: "string" },
  },
  {
    name: "run_command",
    description:
      "Run an allowlisted shell command (only if AGENT_ALLOW_SHELL=1)",
    args: { command: "string" },
  },
  {
    name: "done",
    description: "Finish the job with the final markdown answer",
    args: { answer: "string" },
  },
];

export async function executeTool(name, args = {}) {
  switch (name) {
    case "web_search":
      return webSearch(String(args.query || ""));
    case "fetch_url":
      return fetchUrl(String(args.url || ""));
    case "read_file":
      return readFileTool(String(args.path || ""));
    case "list_dir":
      return listDirTool(String(args.path || "."));
    case "run_command":
      return runCommandTool(String(args.command || ""));
    case "done":
      return { ok: true, answer: String(args.answer || "") };
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

async function webSearch(query) {
  if (!query.trim()) return { ok: false, error: "query required" };
  const results = [];

  try {
    const ddg = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      {
        headers: { "User-Agent": "DAT-STARCODER-agent/0.1" },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (ddg.ok) {
      const data = await ddg.json();
      if (data.AbstractText) {
        results.push({
          title: data.Heading || "Summary",
          url: data.AbstractURL || "",
          snippet: data.AbstractText,
        });
      }
      for (const topic of data.RelatedTopics || []) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.slice(0, 80),
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
        for (const t of topic.Topics || []) {
          if (t.Text && t.FirstURL) {
            results.push({
              title: t.Text.slice(0, 80),
              url: t.FirstURL,
              snippet: t.Text,
            });
          }
        }
      }
    }
  } catch (err) {
    results.push({
      title: "duckduckgo_api_error",
      url: "",
      snippet: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const htmlRes = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; DAT-STARCODER/0.1; +https://localhost)",
        },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (htmlRes.ok) {
      const html = await htmlRes.text();
      const re =
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(html)) && results.length < 8) {
        const url = decodeDuckUrl(m[1]);
        const title = stripTags(m[2]).trim();
        if (url && title) results.push({ title, url, snippet: "" });
      }
    }
  } catch {
    // optional path
  }

  return {
    ok: true,
    query,
    results: results.slice(0, 6),
  };
}

function decodeDuckUrl(href) {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    if (u.pathname === "/l/" && u.searchParams.get("uddg")) {
      return decodeURIComponent(u.searchParams.get("uddg"));
    }
    return u.href;
  } catch {
    return href;
  }
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
}

async function fetchUrl(url) {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "Only http(s) URLs allowed" };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DAT-STARCODER-agent/0.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const ctype = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    const sliced = buf.subarray(0, MAX_FETCH_BYTES);
    let text = sliced.toString("utf8");
    if (/html/i.test(ctype)) {
      text = stripTags(text).replace(/\s+/g, " ").trim();
    }
    return {
      ok: res.ok,
      status: res.status,
      contentType: ctype,
      text: text.slice(0, MAX_FETCH_BYTES),
      truncated: buf.length > MAX_FETCH_BYTES,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readFileTool(rel) {
  try {
    const full = resolveSafe(rel);
    const st = await fs.stat(full);
    if (!st.isFile()) return { ok: false, error: "Not a file" };
    const buf = await fs.readFile(full);
    const text = buf.subarray(0, MAX_FILE_BYTES).toString("utf8");
    return {
      ok: true,
      path: path.relative(REPO_ROOT, full),
      text,
      truncated: buf.length > MAX_FILE_BYTES,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function listDirTool(rel) {
  try {
    const full = resolveSafe(rel);
    const entries = await fs.readdir(full, { withFileTypes: true });
    return {
      ok: true,
      path: path.relative(REPO_ROOT, full) || ".",
      entries: entries.slice(0, 200).map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runCommandTool(command) {
  if (!ALLOW_SHELL) {
    return {
      ok: false,
      error:
        "Shell disabled. Set AGENT_ALLOW_SHELL=1 on the worker to enable allowlisted commands.",
    };
  }
  const cmd = command.trim();
  if (!cmd || cmd.length > 400) {
    return { ok: false, error: "Invalid command" };
  }
  if (!SHELL_ALLOW.test(cmd) || /[;&|`$<>]/.test(cmd)) {
    return {
      ok: false,
      error:
        "Command not allowlisted or contains shell metacharacters. Use a simple allowlisted binary.",
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["-lc", cmd],
      {
        cwd: REPO_ROOT,
        timeout: 20_000,
        maxBuffer: 64 * 1024,
        env: { ...process.env, PATH: process.env.PATH },
      },
    );
    return {
      ok: true,
      stdout: String(stdout).slice(0, 16_000),
      stderr: String(stderr).slice(0, 4_000),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stdout: err?.stdout ? String(err.stdout).slice(0, 8_000) : "",
      stderr: err?.stderr ? String(err.stderr).slice(0, 4_000) : "",
    };
  }
}
