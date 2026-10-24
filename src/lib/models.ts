/**
 * Models offered in Studio. IDs match Ollama tags the operator should pull.
 * Auto resolves to a concrete model before the job is queued.
 */

import { detectAgentProfile } from "@/lib/agent-profile";
import type { AgentProfile } from "@/lib/types";

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
    blurb: "Picks model + specialty (coding, ChiaLisp, OS) from your prompt",
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

const HARD_HINT =
  /\b(chialisp|clvm|architecture|migrate|from scratch|multi-file|security|race condition|refactor (the |entire |whole )|production|consensus|curry|coinset)\b/i;

export type ResolveModelResult = {
  requested: string;
  resolved: string;
  reason: string;
  agentProfile: AgentProfile;
  difficulty: "standard" | "hard";
};

/**
 * Resolve Auto (or an explicit id) to an Ollama model tag + agent profile.
 */
export function resolveModel(
  modelId: string | null | undefined,
  prompt: string,
): ResolveModelResult {
  const requested = modelId?.trim() || DEFAULT_MODEL_ID;
  const option = MODEL_OPTIONS.find((m) => m.id === requested);
  const agentProfile = detectAgentProfile(prompt);
  const hard =
    HARD_HINT.test(prompt) ||
    agentProfile === "chialisp" ||
    prompt.trim().length > 900;

  if (option && option.kind !== "auto" && option.ollamaTag) {
    return {
      requested: option.id,
      resolved: option.ollamaTag,
      reason: `User selected ${option.label} · profile ${agentProfile}`,
      agentProfile,
      difficulty: hard ? "hard" : "standard",
    };
  }

  // Unknown id that looks like an ollama tag — pass through.
  if (requested !== "auto" && requested.includes(":")) {
    return {
      requested,
      resolved: requested,
      reason: `Custom Ollama tag · profile ${agentProfile}`,
      agentProfile,
      difficulty: hard ? "hard" : "standard",
    };
  }

  if (agentProfile === "general" || agentProfile === "ops") {
    return {
      requested: "auto",
      resolved: DEFAULT_GENERAL_MODEL,
      reason:
        agentProfile === "ops"
          ? "Auto: OS/ops question → general model"
          : "Auto: prompt looks like general Q&A",
      agentProfile,
      difficulty: hard ? "hard" : "standard",
    };
  }

  const resolved = hard ? DEFAULT_STRONG_CODING_MODEL : DEFAULT_CODING_MODEL;
  return {
    requested: "auto",
    resolved,
    reason: hard
      ? `Auto: hard ${agentProfile} task → ${resolved}`
      : `Auto: ${agentProfile} task → ${resolved}`,
    agentProfile,
    difficulty: hard ? "hard" : "standard",
  };
}

export function getModelOption(id: string) {
  return MODEL_OPTIONS.find((m) => m.id === id);
}
