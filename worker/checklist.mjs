/**
 * A project checklist that survives follow-up turns.
 * The first prompt locks the summary and the checks. Later prompts add checks.
 */
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { isPlayableGamePrompt } from "./goals.mjs";
import { checkPlayablePage } from "./play-check.mjs";

const MAX_CHECKS = 6;

function checkId(kind, text) {
  const slug = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${kind}-${slug || "item"}`;
}

/**
 * @param {string} prompt
 * @returns {{ id: string, kind: string, text: string, file: string, status: string, detail: string }[]}
 */
export function checksFromPrompt(prompt) {
  const text = String(prompt || "");
  /** @type {{ id: string, kind: string, text: string, file: string, status: string, detail: string }[]} */
  const checks = [];
  const push = (kind, label, file) => {
    const item = {
      id: checkId(kind, label),
      kind,
      text: label,
      file,
      status: "open",
      detail: "",
    };
    if (checks.some((c) => c.id === item.id)) return;
    if (checks.length >= MAX_CHECKS) return;
    checks.push(item);
  };

  if (isPlayableGamePrompt(text)) {
    push(
      "play",
      "Clicking Start, Play, or Deal shows a card, score, or winner",
      "index.html",
    );
    push("page", "index.html is the page Play in Studio opens", "index.html");
  }

  const quoted = [...text.matchAll(/[“"]([^"”\n]{2,80})[”"]/g)].map((m) =>
    m[1].trim(),
  );
  const heading = text.match(
    /\b(?:heading|title|button|label)\b[^.\n]{0,60}?\bto\s+["']?([^"'\n.]{2,60})/i,
  );
  const phrases = [...quoted];
  if (heading) phrases.push(heading[1].trim());
  for (const phrase of phrases) {
    push("text", phrase, "index.html");
  }

  if (/\brust\b|\brustc\b|\bcargo(?:\.toml)?\b|\.rs\b/i.test(text)) {
    push("cargo", "cargo check exits 0", "Cargo.toml");
  }

  if (
    !checks.length &&
    /\b(website|web\s*page|landing\s*page|index\.html)\b/i.test(text)
  ) {
    push("page", "index.html is the page Play in Studio opens", "index.html");
  }

  return checks;
}

/**
 * @param {unknown[]} prev
 * @param {ReturnType<typeof checksFromPrompt>} incoming
 */
export function mergeChecks(prev, incoming) {
  const out = Array.isArray(prev)
    ? prev.filter((c) => c && typeof c === "object").map((c) => ({ ...c }))
    : [];
  for (const check of incoming || []) {
    if (out.some((c) => c.id === check.id)) continue;
    if (out.length >= MAX_CHECKS) break;
    out.push(check);
  }
  return out;
}

/**
 * @param {string} prompt
 * @param {Record<string, unknown>|null|undefined} prev
 */
export function deriveProjectGoal(prompt, prev = null) {
  const text = String(prompt || "").trim();
  const prevGoal =
    prev && typeof prev === "object" && prev.projectGoal
      ? /** @type {Record<string, unknown>} */ (prev.projectGoal)
      : null;
  const summary = prevGoal?.summary
    ? String(prevGoal.summary)
    : text.length > 0
      ? text.replace(/\s+/g, " ").slice(0, 240)
      : "Continue project";
  const checks = mergeChecks(prevGoal?.checks, checksFromPrompt(text));
  const openQuestions = Array.isArray(prevGoal?.openQuestions)
    ? prevGoal.openQuestions.slice(0, 8)
    : [];
  const open = checks.filter((c) => c.status !== "passed");
  return {
    summary,
    doneWhen: checks.length
      ? open.length
        ? open.map((c) => c.text).join("; ")
        : "All checklist items passed"
      : String(
          prevGoal?.doneWhen ||
            "Runnable deliverable verified (build/test or preview URL) and summarized for the user",
        ),
    status: checks.length && open.length === 0 ? "done" : "active",
    checks,
    openQuestions,
    updatedFromPrompt: text.slice(0, 120),
  };
}

/**
 * @param {Record<string, unknown>} goal
 * @param {Record<string, unknown>[]} checks
 */
export function withCheckResults(goal, checks) {
  const open = checks.filter((c) => c.status !== "passed");
  return {
    ...goal,
    checks,
    status: checks.length && open.length === 0 ? "done" : "active",
    doneWhen: checks.length
      ? open.length
        ? open.map((c) => String(c.text)).join("; ")
        : "All checklist items passed"
      : goal?.doneWhen,
  };
}

/**
 * @param {Record<string, unknown>[]} checks
 */
export function firstOpenCheck(checks) {
  const list = Array.isArray(checks) ? checks : [];
  return (
    list.find((c) => c.status === "failed") ||
    list.find((c) => c.status === "open") ||
    null
  );
}

/**
 * @param {Record<string, unknown>} check
 */
export function checklistFollowup(check) {
  return [
    "The project checklist is still open. Continue the same project.",
    "",
    `First check: ${check.text}`,
    `File: ${check.file || "the project files"}`,
    check.detail ? `Last result: ${check.detail}` : "",
    "",
    "Open that file and make this check pass. Do not rebuild the project from scratch, do not call screenshot_url, and do not add http-server unless the user asked for a server.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * @param {Record<string, unknown>[]} checks
 */
export function formatChecklistMarkdown(checks) {
  if (!Array.isArray(checks) || !checks.length) return "";
  const lines = ["## Checklist", ""];
  for (const check of checks) {
    const mark = check.status === "passed" ? "x" : " ";
    const detail =
      check.status === "failed" && check.detail ? ` — ${check.detail}` : "";
    lines.push(`- [${mark}] ${check.text}${detail}`);
  }
  if (checks.some((c) => c.status === "failed")) {
    lines.push("", "## Checklist failed", "");
    const failed = checks.find((c) => c.status === "failed");
    lines.push(String(failed?.detail || failed?.text || "A checklist item is still open."));
  }
  return lines.join("\n");
}

/**
 * @param {string} prompt
 */
export function promptWantsDevServer(prompt) {
  return /\b(dev server|start a server|http-server|npm run dev|next\.?js|express|vite|api server)\b/i.test(
    String(prompt || ""),
  );
}

/**
 * @param {string} command
 */
export function commandIsStaticServer(command) {
  return /\bhttp-server\b|\bpython3?\s+-m\s+http\.server\b/i.test(
    String(command || ""),
  );
}

/** package.json `dev` that only serves static files. */
export async function packageDevIsStaticServer(root) {
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    );
    return commandIsStaticServer(String(pkg?.scripts?.dev || ""));
  } catch {
    return false;
  }
}

/**
 * @param {string} root
 */
export async function readWorkspaceText(root) {
  const chunks = [];
  let total = 0;
  async function walk(dir, rel) {
    if (total > 200_000) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (total > 200_000) return;
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "target" ||
        entry.name === ".datstarcoder" ||
        entry.name === "turns"
      ) {
        continue;
      }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, childRel);
        continue;
      }
      if (/(^|\/)(RESULT\.md|job\.json|package-lock\.json)$/i.test(childRel)) {
        continue;
      }
      if (!/\.(html?|css|js|mjs|tsx?|jsx|rs|md)$/i.test(entry.name)) continue;
      let body = "";
      try {
        body = await fs.readFile(full, "utf8");
      } catch {
        continue;
      }
      const slice = body.slice(0, 40_000);
      chunks.push(slice);
      total += slice.length;
    }
  }
  await walk(root, "");
  return chunks.join("\n");
}

function runCargoCheck(root) {
  return new Promise((resolve) => {
    execFile(
      "cargo",
      ["check"],
      { cwd: root, timeout: 60_000 },
      (err, stdout, stderr) => {
        if (err && err.code === "ENOENT") {
          resolve({ ok: false, missing: true, output: "" });
          return;
        }
        const output = `${stdout || ""}\n${stderr || ""}`.slice(0, 1500);
        resolve({ ok: !err, missing: false, output });
      },
    );
  });
}

/**
 * @param {string} root
 * @param {Record<string, unknown>[]} checks
 * @param {{ play?: Function, readText?: Function, cargo?: Function }} [hooks]
 */
export async function evaluateChecklist(root, checks, hooks = {}) {
  const play = hooks.play || checkPlayablePage;
  const readText = hooks.readText || (() => readWorkspaceText(root));
  const cargo = hooks.cargo || (() => runCargoCheck(root));
  let haystack = "";
  let hayReady = false;
  const ensureText = async () => {
    if (!hayReady) {
      haystack = String(await readText());
      hayReady = true;
    }
    return haystack;
  };

  const next = [];
  for (const check of checks || []) {
    if (check.kind === "play") {
      const probe = await play(root);
      if (probe?.skipped) {
        next.push({ ...check, status: "open", detail: probe.reason || "skipped" });
      } else if (probe?.ok) {
        next.push({
          ...check,
          status: "passed",
          detail: probe.reason || "Click changed the page",
        });
      } else {
        next.push({
          ...check,
          status: "failed",
          detail: probe?.reason || "Click did nothing",
        });
      }
      continue;
    }
    if (check.kind === "text") {
      const hay = (await ensureText()).toLowerCase();
      const needle = String(check.text || "").toLowerCase();
      const ok = needle.length > 0 && hay.includes(needle);
      next.push({
        ...check,
        status: ok ? "passed" : "failed",
        detail: ok
          ? "Found in the project files"
          : `“${check.text}” is not in the project files`,
      });
      continue;
    }
    if (check.kind === "page") {
      let html = "";
      for (const rel of ["index.html", "src/index.html"]) {
        try {
          html = await fs.readFile(path.join(root, rel), "utf8");
          break;
        } catch {
          /* try the next path */
        }
      }
      const ok = html.trim().length > 40;
      next.push({
        ...check,
        status: ok ? "passed" : "failed",
        detail: ok ? "index.html is in the project" : "index.html is missing",
      });
      continue;
    }
    if (check.kind === "cargo") {
      const result = await cargo(root);
      if (result?.missing) {
        next.push({
          ...check,
          status: "open",
          detail: "cargo is not installed on the worker",
        });
      } else if (result?.ok) {
        next.push({ ...check, status: "passed", detail: "cargo check exited 0" });
      } else {
        next.push({
          ...check,
          status: "failed",
          detail: "cargo check failed",
        });
      }
      continue;
    }
    next.push(check);
  }
  return next;
}
