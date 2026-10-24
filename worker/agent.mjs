/**
 * Multi-step tool-using agent loop backed by Ollama.
 */

import { retrieveKnowledge, packsForProfile } from "./knowledge.mjs";
import { TOOL_SPECS, executeTool } from "./tools.mjs";

const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(
  /\/$/,
  "",
);
const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 8);

function profileSystem(profile, kind) {
  if (kind === "plan") {
    return [
      "You are DAT STARCODER planning a multi-step project.",
      "Produce a short markdown plan for the user, then emit the PLAN_JSON block exactly as requested in the user message.",
      "You may use tools (web_search, fetch_url) if you need current facts before planning.",
      "When finished, call done with the full markdown including the PLAN_JSON block.",
    ].join(" ");
  }

  const base = {
    coding:
      "You are DAT STARCODER, a careful coding agent. Prefer concrete patches, commands, and tests.",
    general: [
      "You are DAT STARCODER answering everyday and general questions.",
      "Be accurate, clear, and unbiased: present major viewpoints fairly when a topic is contested,",
      "distinguish facts from opinions, and say when you are unsure.",
      "Do not push politics, religion, or product pitches. Avoid stereotypes.",
      "For changing facts (news, prices, versions, laws), use web_search and cite what you found.",
      "For medical, legal, or financial topics, give general information only and suggest a qualified professional when stakes are high.",
      "Never invent citations or pretend to have private knowledge of the user.",
    ].join(" "),
    chialisp: [
      "You are DAT STARCODER specializing in Chia, ChiaLisp, and CLVM.",
      "Be precise about puzzles, solutions, conditions, curry vs solution args.",
      "When you propose CLVM/ChiaLisp, call clvm_verify (mode=run or brun) before finishing.",
      "If verification fails, fix the program or explain the failure clearly.",
    ].join(" "),
    ops: "You are DAT STARCODER helping people navigate their computers — Windows, macOS, ChromeOS/Chromebook, and Linux. Infer or ask which OS they use. Prefer Settings/UI click paths first, then Terminal/PowerShell. Never ask for passwords or recovery keys. Use web_search when menus may have changed by version.",
  }[profile] || "You are DAT STARCODER.";

  return [
    base,
    "You can call tools to search the web, fetch docs, inspect local files, and verify CLVM.",
    "Work step-by-step. Use tools when unsure or when facts may be stale.",
    "When you have the final answer, call the done tool.",
  ].join(" ");
}

function toolInstructions() {
  const lines = TOOL_SPECS.map(
    (t) => `- ${t.name}: ${t.description} args=${JSON.stringify(t.args)}`,
  );
  return [
    "Respond with EXACTLY one of these forms (no surrounding prose):",
    'TOOL {"name":"web_search","args":{"query":"..."}}',
    'DONE {"answer":"markdown final answer"}',
    "",
    "Available tools:",
    ...lines,
  ].join("\n");
}

function buildMessages(job) {
  const profile = job.agentProfile || "coding";
  const packs = packsForProfile(profile);
  const chunks = retrieveKnowledge(job.prompt, { packs, limit: 4 });
  const knowledge =
    chunks.length === 0
      ? ""
      : [
          "Retrieved knowledge:",
          ...chunks.map((c) => `### ${c.title}\n${c.text}`),
        ].join("\n\n");

  const system = [
    profileSystem(profile, job.kind || "task"),
    toolInstructions(),
    knowledge,
    job.repoHint ? `Repo/path hint: ${job.repoHint}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: job.prompt },
  ];
}

function parseAction(text) {
  const trimmed = String(text || "").trim();
  const toolMatch =
    trimmed.match(/TOOL\s*(\{[\s\S]*\})\s*$/i) ||
    trimmed.match(/TOOL\s*(\{[\s\S]*\})/i);
  const doneMatch =
    trimmed.match(/DONE\s*(\{[\s\S]*\})\s*$/i) ||
    trimmed.match(/DONE\s*(\{[\s\S]*\})/i);

  if (toolMatch) {
    try {
      const obj = JSON.parse(toolMatch[1]);
      if (obj.name === "done") {
        return { type: "done", answer: String(obj.args?.answer || "") };
      }
      return {
        type: "tool",
        name: String(obj.name || ""),
        args: obj.args || {},
      };
    } catch {
      /* fall through */
    }
  }
  if (doneMatch) {
    try {
      const obj = JSON.parse(doneMatch[1]);
      return { type: "done", answer: String(obj.answer || "") };
    } catch {
      /* fall through */
    }
  }

  try {
    const obj = JSON.parse(trimmed);
    if (obj.name === "done" || obj.type === "done") {
      return {
        type: "done",
        answer: String(obj.answer || obj.args?.answer || ""),
      };
    }
    if (obj.name) {
      return { type: "tool", name: String(obj.name), args: obj.args || {} };
    }
  } catch {
    /* ignore */
  }

  if (trimmed.length > 400 && !/^TOOL\b/i.test(trimmed)) {
    return { type: "done", answer: trimmed };
  }

  return {
    type: "tool",
    name: "done",
    args: {
      answer:
        trimmed ||
        "(Model returned an empty response. Retry with a clearer prompt.)",
    },
  };
}

async function ollamaChat(model, messages) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.message?.content || "";
}

/**
 * @param {object} job
 * @param {{ onEvent?: (e: {type:string,message:string,data?:object|null}) => Promise<void>|void }} [hooks]
 * @returns {{ result: string, toolSteps: number }}
 */
export async function runAgentJob(job, hooks = {}) {
  const model =
    job.modelResolved || process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
  const messages = buildMessages(job);
  const trace = [];
  let toolSteps = 0;
  const emit = async (type, message, data = null) => {
    if (hooks.onEvent) await hooks.onEvent({ type, message, data });
  };

  try {
    await emit("status", `Starting agent · ${model} · ${job.agentProfile || "auto"}`);

    for (let i = 0; i < MAX_STEPS; i++) {
      await emit("log", `Thinking (step ${i + 1}/${MAX_STEPS})…`);
      const content = await ollamaChat(model, messages);
      messages.push({ role: "assistant", content });
      const action = parseAction(content);

      if (action.type === "done" || action.name === "done") {
        const answer = action.answer || action.args?.answer || content;
        await emit("status", "Finishing answer");
        const header = [
          `Model: ${job.modelRequested || "auto"} → ${model}`,
          job.modelReason ? `Reason: ${job.modelReason}` : "",
          job.agentProfile ? `Profile: ${job.agentProfile}` : "",
          `Tool steps: ${toolSteps}`,
          "",
        ]
          .filter(Boolean)
          .join("\n");

        if (trace.length) {
          return {
            result: `${header}${answer}\n\n---\n### Agent tool trace\n${trace.join("\n")}`,
            toolSteps,
          };
        }
        return { result: `${header}${answer}`, toolSteps };
      }

      toolSteps += 1;
      const name = action.name;
      const args = action.args || {};
      await emit("tool", `${name}`, {
        name,
        args: truncateData(args),
        step: toolSteps,
      });
      const observation = await executeTool(name, args);
      await emit(
        "tool_result",
        `${name}: ${observation.ok === false ? "error" : "ok"}`,
        {
          name,
          ok: observation.ok !== false,
          summary: summarizeObservation(observation),
        },
      );

      if (name === "done") {
        const answer = observation.answer || "";
        const header = [
          `Model: ${job.modelRequested || "auto"} → ${model}`,
          job.modelReason ? `Reason: ${job.modelReason}` : "",
          job.agentProfile ? `Profile: ${job.agentProfile}` : "",
          `Tool steps: ${toolSteps}`,
          "",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          result: `${header}${answer}\n\n---\n### Agent tool trace\n${trace.concat(`done`).join("\n")}`,
          toolSteps,
        };
      }

      const summary = `${toolSteps}. ${name}(${JSON.stringify(args).slice(0, 120)})`;
      trace.push(summary);
      messages.push({
        role: "user",
        content: `TOOL_RESULT ${name}:\n${JSON.stringify(observation).slice(0, 12_000)}\n\nContinue. Call another TOOL or DONE.`,
      });
    }

    await emit("error", `Hit AGENT_MAX_STEPS=${MAX_STEPS}`);
    return {
      result: [
        `# Partial result (hit AGENT_MAX_STEPS=${MAX_STEPS})`,
        "",
        "The agent used the maximum number of tool steps without calling done.",
        "",
        "### Trace",
        ...trace,
      ].join("\n"),
      toolSteps,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await emit("error", reason);
    return {
      result: [
        `# Offline fallback (Ollama/tools error: ${reason})`,
        "",
        `Model target: ${model}`,
        "",
        "## Request",
        job.prompt,
        "",
        "## Suggested next step",
        `1. ollama pull ${model}`,
        "2. Confirm Ollama is running on OLLAMA_URL.",
        "3. Restart this worker.",
      ].join("\n"),
      toolSteps,
    };
  }
}

function truncateData(obj) {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= 800) return obj;
    return { _truncated: s.slice(0, 800) };
  } catch {
    return null;
  }
}

function summarizeObservation(obs) {
  if (!obs || typeof obs !== "object") return String(obs).slice(0, 240);
  if (obs.error) return String(obs.error).slice(0, 240);
  if (obs.output) return String(obs.output).slice(0, 240);
  if (obs.answer) return String(obs.answer).slice(0, 240);
  if (Array.isArray(obs.results)) return `${obs.results.length} search hits`;
  if (obs.text) return String(obs.text).slice(0, 240);
  try {
    return JSON.stringify(obs).slice(0, 240);
  } catch {
    return "ok";
  }
}
