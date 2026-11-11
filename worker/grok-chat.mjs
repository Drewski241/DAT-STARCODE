/**
 * Grok chat for the worker agent loop.
 * Returns the same shape as ollamaChat: { content, toolCalls, rawMessage }.
 * The API key stays in XAI_API_KEY on the worker.
 */

const DEFAULT_MODEL = "grok-4.7";
const DEFAULT_BASE = "https://api.x.ai/v1";
const DEFAULT_TIMEOUT_MS = 180_000;

export function isGrokModel(model) {
  if (!model) return false;
  const id = String(model).trim().toLowerCase();
  return id === "grok" || id.startsWith("grok-");
}

function apiModel(resolved) {
  const override = process.env.XAI_MODEL?.trim();
  if (override) return override;
  if (String(resolved).toLowerCase().startsWith("grok-")) return resolved;
  return DEFAULT_MODEL;
}

function baseUrl() {
  return (process.env.XAI_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

function timeoutMs() {
  const parsed = Number(process.env.XAI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("");
}

/**
 * Flatten tool-call history into text. The agent stores observations as
 * user messages, and the API rejects assistant tool_calls that have no
 * matching tool result.
 * @param {any[]} messages
 */
function toApiMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const role =
      message?.role === "system" || message?.role === "assistant"
        ? message.role
        : "user";
    let content = typeof message?.content === "string" ? message.content : "";
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
      const summary = message.tool_calls
        .map((call) => {
          const name = call?.function?.name || "tool";
          const args = call?.function?.arguments;
          const rendered =
            typeof args === "string" ? args : JSON.stringify(args ?? {});
          return `${name} ${rendered}`;
        })
        .join("\n");
      content = [content, summary].filter(Boolean).join("\n");
    }
    return { role, content: content || "" };
  });
}

function toolCallsFrom(message) {
  const calls = message?.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.map((call) => ({
    id: call.id,
    type: call.type || "function",
    function: {
      name: call.function?.name || "",
      arguments: call.function?.arguments ?? {},
    },
  }));
}

function errorDetail(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.error === "string") return parsed.error.slice(0, 300);
    if (parsed.error?.message) return String(parsed.error.message).slice(0, 300);
  } catch {
    /* not JSON */
  }
  return String(raw || "").slice(0, 300);
}

/**
 * @param {string} model
 * @param {any[]} messages
 * @param {(chunk: string, full: string) => Promise<void>|void} [onToken]
 * @param {{ tools?: any[], onHeartbeat?: (line: string) => void }} [opts]
 */
export async function grokChat(model, messages, onToken, opts = {}) {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "XAI_API_KEY is not set on this worker. Hard coding tasks cannot call Grok.",
    );
  }

  const requested = apiModel(model);
  const limit = timeoutMs();
  const started = Date.now();
  const timer = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    opts.onHeartbeat?.(`Grok still working · ${sec}s`);
  }, 15_000);
  timer.unref?.();

  try {
    const body = {
      model: requested,
      stream: false,
      messages: toApiMessages(messages),
    };
    if (opts.tools?.length) body.tools = opts.tools;

    let res;
    try {
      res = await fetch(`${baseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(limit),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`Grok API timed out after ${limit}ms`);
      }
      throw new Error(err instanceof Error ? err.message : String(err));
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Grok API ${res.status}: ${errorDetail(raw)}`);
    }

    let message;
    try {
      const data = JSON.parse(raw);
      message = data.choices?.[0]?.message;
    } catch {
      throw new Error("Grok API returned a response that was not JSON");
    }

    const content =
      textOf(message?.content) || textOf(message?.reasoning_content);
    const toolCalls = toolCallsFrom(message);
    if (!content.trim() && toolCalls.length === 0) {
      throw new Error("Grok API returned an empty answer");
    }
    if (content && onToken) await onToken(content, content);
    return { content, toolCalls, rawMessage: message };
  } finally {
    clearInterval(timer);
  }
}
