/**
 * Models offered in Studio. IDs match Ollama tags the operator should pull.
 * Auto resolves to a concrete model before the job is queued.
 */

import { inferGoal } from "@/lib/goals";

export type ModelKind = "auto" | "coding" | "general";

export type ModelOption = {
  id: string;
  label: string;
  kind: ModelKind;
  ollamaTag: string | null;
  blurb: string;
};

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "auto",
    label: "Auto",
    kind: "auto",
    ollamaTag: null,
    blurb:
      "Picks from your prompt (simple coding → 7B; hard/error/multi-file/Next → 14B; shopping Q&A → Qwen 7B)",
  },
  {
    id: "qwen2.5-coder:7b",
    label: "Coder 7B",
    kind: "coding",
    ollamaTag: "qwen2.5-coder:7b",
    blurb: "Fast coding agent (default GPU pick)",
  },
  {
    id: "qwen2.5-coder:14b",
    label: "Coder 14B",
    kind: "coding",
    ollamaTag: "qwen2.5-coder:14b",
    blurb: "Stronger coding; needs more VRAM",
  },
  {
    id: "qwen2.5:7b",
    label: "Qwen 7B",
    kind: "general",
    ollamaTag: "qwen2.5:7b",
    blurb: "General chat and reasoning",
  },
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    kind: "general",
    ollamaTag: "llama3.1:8b",
    blurb: "General-purpose assistant",
  },
];

export const DEFAULT_MODEL_ID = "auto";
export const DEFAULT_CODING_MODEL = "qwen2.5-coder:7b";
/** Stronger default when Auto detects ChiaLisp / MTT / other hard domains. */
export const DEFAULT_HARD_CODING_MODEL = "qwen2.5-coder:14b";
export const DEFAULT_GENERAL_MODEL = "llama3.1:8b";
/** Better instruction-following for shopping / local research Q&A. */
export const DEFAULT_RESEARCH_GENERAL_MODEL = "qwen2.5:7b";

const CODING_HINT =
  /\b(code|coding|function|bug|fix|refactor|implement|typescript|javascript|python|rust|go\b|api|endpoint|class|module|commit|diff|pr\b|pull request|compile|lint|test|unit test|css|html|sql|docker|kubernetes|cli|script|repo|github|stack trace|error:|npm|cargo|pytest|build|game|app|website|page|component|ui|frontend|backend|playable|browser|canvas|sprite|unicorn|bubbles?|jump|platformer|make me|create a|write a|puzzle|chialisp|\.clsp|write_file|str_replace|screenshot_url|package\.json|index\.html|heading|h1)\b/i;

/** Short Studio follow-ups in an existing project ("change the heading"). */
const EDIT_FOLLOWUP_HINT =
  /\b(change|update|rename|edit|replace|find where|move|delete|add (a |the )?(button|link|heading|title|file|script|test)|overwrite)\b/i;

const RESEARCH_HINT =
  /\b(best|cheap|cheapest|affordable|lowest|compare|comparison|which|vs\b|versus|quote|quotes|buy|purchase|insurance|broker|price|cost|victoria|vancouver|icbc|how (do|should) i|where (do|can|should) i)\b/i;

/**
 * Resolve Auto (or an explicit id) to an Ollama model tag.
 */
export function resolveModel(
  modelId: string | null | undefined,
  prompt: string,
  opts?: { preferCoding?: boolean },
): { requested: string; resolved: string; reason: string } {
  const requested = modelId?.trim() || DEFAULT_MODEL_ID;
  const option = MODEL_OPTIONS.find((m) => m.id === requested);

  if (option && option.kind !== "auto" && option.ollamaTag) {
    return {
      requested: option.id,
      resolved: option.ollamaTag,
      reason: `User selected ${option.label}`,
    };
  }

  // Unknown id that looks like an ollama tag — pass through.
  if (requested !== "auto" && requested.includes(":")) {
    return {
      requested,
      resolved: requested,
      reason: "Custom Ollama tag",
    };
  }

  const goal = inferGoal(prompt);
  const escalate =
    /\b(next\.js|refactor|typescript|multi-?file|playwright|hydrate|monorepo)\b/i.test(
      prompt,
    ) ||
    /ERROR_CLASS:\s*(typescript|next_build|deps_missing)/i.test(prompt) ||
    /Coding verify failed|VERIFY_FAIL_STREAK:\s*[2-9]|verifyFailStreak["']?\s*:\s*[2-9]/i.test(
      prompt,
    );

  if (goal.hard || (goal.id === "coding" && escalate)) {
    return {
      requested: "auto",
      resolved: DEFAULT_HARD_CODING_MODEL,
      reason: goal.hard
        ? `Auto: hard domain (${goal.label}) → ${DEFAULT_HARD_CODING_MODEL}`
        : `Auto: complex coding cues → ${DEFAULT_HARD_CODING_MODEL}`,
    };
  }

  const coding =
    goal.id === "coding" ||
    CODING_HINT.test(prompt) ||
    (Boolean(opts?.preferCoding) && EDIT_FOLLOWUP_HINT.test(prompt)) ||
    (Boolean(opts?.preferCoding) && prompt.trim().length < 160);
  if (coding) {
    return {
      requested: "auto",
      resolved: DEFAULT_CODING_MODEL,
      reason: opts?.preferCoding
        ? "Auto: continuing coding project"
        : "Auto: prompt looks like a coding task",
    };
  }

  const research = RESEARCH_HINT.test(prompt);
  const resolved = research
    ? DEFAULT_RESEARCH_GENERAL_MODEL
    : DEFAULT_GENERAL_MODEL;
  return {
    requested: "auto",
    resolved,
    reason: research
      ? `Auto: research / shopping Q&A → ${resolved}`
      : "Auto: prompt looks like general Q&A",
  };
}

export function getModelOption(id: string) {
  return MODEL_OPTIONS.find((m) => m.id === id);
}
