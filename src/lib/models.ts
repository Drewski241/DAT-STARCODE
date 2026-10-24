/**
 * Models offered in Studio. IDs match Ollama tags the operator should pull.
 * Auto resolves to a concrete model before the job is queued.
 */

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
      "Picks coding vs general (ChiaLisp / hard tasks prefer 14B when available)",
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
    blurb: "Stronger coding / ChiaLisp; needs more VRAM",
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
export const DEFAULT_STRONG_CODING_MODEL = "qwen2.5-coder:14b";
export const DEFAULT_GENERAL_MODEL = "llama3.1:8b";

const CODING_HINT =
  /\b(code|coding|function|bug|fix|refactor|implement|typescript|javascript|python|rust|go\b|api|endpoint|class|module|commit|diff|pr\b|pull request|compile|lint|test|unit test|css|html|sql|docker|kubernetes|cli|script|repo|github|stack trace|error:|npm|cargo|pytest|build|game|app|website|page|component|ui|frontend|backend|playable|browser|canvas|sprite|unicorn|bubbles?|jump|platformer|make me|create a|write a|chialisp|clvm)\b/i;

const HARD_HINT =
  /\b(chialisp|clvm|architecture|migrate|from scratch|multi-file|security|refactor (the |entire |whole )|production|consensus)\b/i;

/**
 * Resolve Auto (or an explicit id) to an Ollama model tag.
 */
export function resolveModel(
  modelId: string | null | undefined,
  prompt: string,
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

  const coding = CODING_HINT.test(prompt);
  const hard = HARD_HINT.test(prompt) || prompt.trim().length > 900;
  if (!coding) {
    return {
      requested: "auto",
      resolved: DEFAULT_GENERAL_MODEL,
      reason: "Auto: prompt looks like general Q&A",
    };
  }
  const resolved = hard ? DEFAULT_STRONG_CODING_MODEL : DEFAULT_CODING_MODEL;
  return {
    requested: "auto",
    resolved,
    reason: hard
      ? `Auto: hard coding task → ${resolved}`
      : "Auto: prompt looks like a coding task",
  };
}

export function getModelOption(id: string) {
  return MODEL_OPTIONS.find((m) => m.id === id);
}
