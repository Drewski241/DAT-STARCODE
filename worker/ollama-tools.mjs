/**
 * Ollama native tool-calling helpers (with JSON-text fallback elsewhere).
 */
import { CODING_TOOL_SPECS } from "./tool-specs.mjs";

/**
 * Map our stringy arg types → JSON Schema fragments.
 * @param {string} t
 */
function argSchema(t) {
  const raw = String(t || "string");
  const optional = raw.endsWith("?");
  const base = optional ? raw.slice(0, -1) : raw;
  if (base === "boolean") return { type: "boolean" };
  if (base === "number") return { type: "number" };
  if (base === "array" || base.endsWith("[]")) {
    return { type: "array", items: { type: "string" } };
  }
  if (base.includes("|")) {
    return { type: "string", enum: base.split("|") };
  }
  return { type: "string" };
}

/**
 * @param {typeof CODING_TOOL_SPECS} [specs]
 * @param {{ general?: boolean }} [opts]
 */
export function toOllamaTools(specs = CODING_TOOL_SPECS, opts = {}) {
  const list = opts.general
    ? specs.filter(
        (s) =>
          s.name === "web_search" ||
          s.name === "fetch_url" ||
          s.name === "search_flights",
      )
    : specs;
  return list.map((spec) => {
    /** @type {Record<string, object>} */
    const properties = {};
    /** @type {string[]} */
    const required = [];
    for (const [key, typ] of Object.entries(spec.args || {})) {
      properties[key] = argSchema(typ);
      if (!String(typ).endsWith("?")) required.push(key);
    }
    return {
      type: "function",
      function: {
        name: spec.name,
        description: spec.description,
        parameters: {
          type: "object",
          properties,
          ...(required.length ? { required } : {}),
        },
      },
    };
  });
}

/**
 * @param {unknown} args
 */
export function normalizeToolArgs(args) {
  if (args == null) return {};
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof args === "object") return /** @type {Record<string, unknown>} */ (args);
  return {};
}

/**
 * Merge streamed tool_calls chunks (Ollama may send partials).
 * @param {any[]} existing
 * @param {any[]} incoming
 */
export function mergeToolCalls(existing, incoming) {
  const out = Array.isArray(existing) ? [...existing] : [];
  for (const call of incoming || []) {
    const idx =
      typeof call.index === "number"
        ? call.index
        : out.length
          ? out.length - 1
          : 0;
    while (out.length <= idx) out.push({ function: { name: "", arguments: "" } });
    const cur = out[idx];
    const fn = call.function || {};
    if (fn.name) cur.function.name = fn.name;
    if (fn.arguments != null) {
      if (typeof fn.arguments === "object") {
        cur.function.arguments = fn.arguments;
      } else {
        cur.function.arguments = `${cur.function.arguments || ""}${fn.arguments}`;
      }
    }
    if (call.id) cur.id = call.id;
    if (call.type) cur.type = call.type;
  }
  return out;
}

/**
 * @param {any[]} toolCalls
 * @returns {{ tool: string, args: Record<string, unknown>, id?: string }|null}
 */
export function firstToolCallAction(toolCalls) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) return null;
  const call = toolCalls[0];
  const name = call?.function?.name;
  if (!name) return null;
  return {
    tool: String(name),
    args: normalizeToolArgs(call.function?.arguments),
    id: call.id ? String(call.id) : undefined,
  };
}

/**
 * Trim older tool observations so long coding turns fit num_ctx.
 * Keeps system + latest user request + recent tail.
 * @param {any[]} messages
 * @param {{ maxChars?: number }} [opts]
 */
export function trimMessagesForContext(messages, opts = {}) {
  const maxChars = opts.maxChars ?? Number(process.env.AGENT_CONTEXT_CHARS || 48_000);
  const list = Array.isArray(messages) ? [...messages] : [];
  const size = () =>
    list.reduce((n, m) => n + String(m?.content || "").length, 0);
  if (size() <= maxChars) return list;

  // Always keep first system message and the last user prompt before tools
  const system = list[0]?.role === "system" ? [list[0]] : [];
  let body = system.length ? list.slice(1) : [...list];

  // Drop oldest OBSERVATION user messages first
  while (size() > maxChars && body.length > 4) {
    const idx = body.findIndex(
      (m) =>
        m.role === "user" &&
        /^OBSERVATION:/i.test(String(m.content || "")),
    );
    if (idx < 0) break;
    body.splice(idx, 1);
    // Also drop the assistant tool call immediately before if present
    if (idx > 0 && body[idx - 1]?.role === "assistant") {
      body.splice(idx - 1, 1);
    }
  }

  // Hard clip remaining giant observations
  body = body.map((m) => {
    const c = String(m.content || "");
    if (c.length > 6_000 && /^OBSERVATION:/i.test(c)) {
      return { ...m, content: `${c.slice(0, 6_000)}\n…(truncated observation)` };
    }
    return m;
  });

  const next = system.length ? [...system, ...body] : body;
  if (sizeOf(next) > maxChars) {
    // Last resort: keep system + last N messages
    const keep = 12;
    const tail = next.slice(-keep);
    if (system.length && tail[0] !== system[0]) return [...system, ...tail];
    return tail;
  }
  return next;
}

function sizeOf(messages) {
  return messages.reduce((n, m) => n + String(m?.content || "").length, 0);
}
