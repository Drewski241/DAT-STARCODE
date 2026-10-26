/**
 * Validate / repair agent tool actions (native tool_calls + JSON text).
 * Prevents the "unknown tool undefined" death spiral.
 */
import { CODING_TOOL_SPECS } from "./tool-specs.mjs";

const KNOWN = new Set(CODING_TOOL_SPECS.map((s) => s.name));

const ALIASES = {
  search: "search_files",
  search_file: "search_files",
  grep: "search_files",
  find: "search_files",
  list: "list_files",
  ls: "list_files",
  read: "read_file",
  cat: "read_file",
  open: "read_file",
  write: "write_file",
  create: "write_file",
  edit: "str_replace",
  replace: "str_replace",
  patch: "str_replace",
  shell: "run",
  bash: "run",
  exec: "run",
  install: "npm_install",
  screenshot: "screenshot_url",
  capture: "screenshot_url",
  browse: "check_url",
  fetch: "fetch_url",
  search_web: "web_search",
  google: "web_search",
};

/**
 * @param {unknown} name
 */
export function normalizeToolName(name) {
  const trimmed = String(name ?? "")
    .trim()
    .replace(/^functions?\./i, "")
    .replace(/\s+/g, "_");
  // camelCase → snake before lowercasing (writeFile → write_file)
  const snake = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
  if (!snake || snake === "undefined" || snake === "null") return null;
  if (KNOWN.has(snake)) return snake;
  if (ALIASES[snake] && KNOWN.has(ALIASES[snake])) return ALIASES[snake];
  return null;
}

/**
 * Recover a tool action from free-form assistant text when JSON/native failed.
 * @param {string} text
 */
export function recoverActionFromText(text) {
  const raw = String(text || "");
  if (!raw.trim()) return null;

  // Explicit JSON fragments with tool but broken outer parse
  const toolMatch = raw.match(
    /"tool"\s*:\s*"([a-z0-9_]+)"[\s\S]*?"args"\s*:\s*(\{[\s\S]*?\})\s*(?:,|\})/i,
  );
  if (toolMatch) {
    const tool = normalizeToolName(toolMatch[1]);
    if (tool) {
      try {
        return { tool, args: JSON.parse(toolMatch[2]) };
      } catch {
        return { tool, args: {} };
      }
    }
  }

  // OpenAI-style / truncated: {"name":"write_file","arguments":{"path":"..."
  // (7B often dumps this in content instead of native tool_calls, and truncates)
  const openaiName = raw.match(
    /"name"\s*:\s*"(list_files|search_files|read_file|write_file|str_replace|run|npm_install|start_server|stop_server|server_logs|check_url|screenshot_url|web_search|fetch_url|[a-z0-9_]+)"/i,
  );
  if (openaiName) {
    const tool = normalizeToolName(openaiName[1]);
    if (tool) {
      /** @type {Record<string, unknown>} */
      const args = {};
      const pathM = raw.match(/"path"\s*:\s*"([^"\\]+)"/);
      if (pathM) args.path = pathM[1];
      const queryM = raw.match(/"query"\s*:\s*"([^"\\]+)"/);
      if (queryM) args.query = queryM[1];
      const urlM = raw.match(/"url"\s*:\s*"([^"\\]+)"/);
      if (urlM) args.url = urlM[1];
      // Best-effort content recovery (may be truncated mid-string)
      const contentM = raw.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"?/);
      if (contentM) {
        try {
          args.content = JSON.parse(`"${contentM[1]}"`);
        } catch {
          args.content = contentM[1]
            .replace(/\\n/g, "\n")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\");
        }
      }
      return { tool, args };
    }
  }

  // Common prose: write_file path=foo content=...
  const writeEq = raw.match(
    /write_file\s+(?:path\s*=\s*)?["`]?([^\s"`]+)["`]?/i,
  );
  if (writeEq) {
    const contentMatch = raw.match(
      /content\s*=\s*([\s\S]+?)(?:\n\s*\d\)|\n\s*then\s+done|$)/i,
    );
    return {
      tool: "write_file",
      args: {
        path: writeEq[1],
        content: contentMatch ? contentMatch[1].trim() : "",
      },
    };
  }

  if (/\bscreenshot_url\b/i.test(raw)) {
    const url =
      raw.match(/https?:\/\/\S+/i)?.[0] ||
      raw.match(/file:\/\/\S+/i)?.[0] ||
      "index.html";
    return { tool: "screenshot_url", args: { url } };
  }

  if (/\bsearch_files\b/i.test(raw) || /\bfind where\b/i.test(raw)) {
    const q =
      raw.match(/["“]([^"”]+)["”]/)?.[1] ||
      raw.match(/find where\s+(.+?)\s+is/i)?.[1] ||
      "TODO";
    return { tool: "search_files", args: { query: String(q).slice(0, 120) } };
  }

  if (/\blist_files\b/i.test(raw)) {
    return { tool: "list_files", args: {} };
  }

  return null;
}

/**
 * @param {unknown} action
 * @param {string} [assistantText]
 * @param {{ general?: boolean }} [opts]
 */
export function normalizeAgentAction(action, assistantText = "", opts = {}) {
  if (!action || typeof action !== "object") {
    const recovered = recoverActionFromText(assistantText);
    if (recovered) return { ok: true, action: recovered, repaired: true };
    return { ok: false, action: null, reason: "unparsed" };
  }

  const a = /** @type {Record<string, unknown>} */ (action);
  if (a.done === true || a.done === "true") {
    return {
      ok: true,
      action: { done: true, message: String(a.message || assistantText || "") },
      repaired: false,
    };
  }

  let tool = normalizeToolName(a.tool ?? a.name ?? a.function);
  let args =
    a.args && typeof a.args === "object"
      ? /** @type {Record<string, unknown>} */ (a.args)
      : a.arguments && typeof a.arguments === "object"
        ? /** @type {Record<string, unknown>} */ (a.arguments)
        : {};

  if (!tool) {
    const recovered = recoverActionFromText(assistantText);
    if (recovered) {
      return { ok: true, action: recovered, repaired: true };
    }
    return {
      ok: false,
      action: { tool: String(a.tool ?? ""), args },
      reason: "missing_tool",
    };
  }

  if (opts.general) {
    const allowed = new Set(["web_search", "fetch_url"]);
    if (!allowed.has(tool)) {
      return {
        ok: false,
        action: { tool, args },
        reason: "general_tool_blocked",
      };
    }
  } else if (!KNOWN.has(tool)) {
    return { ok: false, action: { tool, args }, reason: "unknown_tool" };
  }

  // Screenshot convenience: bare html path → file URL hint for the tool layer
  if (tool === "screenshot_url" && args.url == null && args.path) {
    args = { ...args, url: String(args.path) };
  }

  return {
    ok: true,
    action: {
      thought: a.thought ? String(a.thought) : undefined,
      tool,
      args,
    },
    repaired: Boolean(a.tool && normalizeToolName(a.tool) !== String(a.tool)),
  };
}

/**
 * @param {{ reason?: string }} [state]
 */
export function toolRepairMessage(state = {}) {
  const names = CODING_TOOL_SPECS.map((s) => s.name).join("|");
  if (state.reason === "general_tool_blocked") {
    return (
      'POLICY: general Q&A may only use web_search / fetch_url, then {"done":true,"message":"..."}.'
    );
  }
  return (
    `POLICY: invalid or missing tool (got undefined/unknown). ` +
    `Reply with ONLY one JSON object: {"tool":"<name>","args":{...}} or {"done":true,"message":"..."}. ` +
    `Allowed tools: ${names}.`
  );
}

/**
 * Prompt looks like a checkpoint / continuity memory question.
 * @param {string} prompt
 */
export function isCheckpointQuestion(prompt) {
  return /\b(what did we learn|last turn|checkpoint|open bugs|never ?do|remember|what were we doing|summarize.*(bug|decision|checkpoint))\b/i.test(
    String(prompt || ""),
  );
}
