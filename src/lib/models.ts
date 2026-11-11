/**
 * Models offered in Studio. IDs match Ollama tags the operator should pull.
 * Auto resolves to a concrete model before the job is queued.
 */

import {
  inferGoal,
  isPlayableGamePrompt,
  priorTurnNeedsStrongerModel,
} from "@/lib/goals";

export type ModelKind = "auto" | "coding" | "general";

export type ModelOption = {
  id: string;
  label: string;
  kind: ModelKind;
  ollamaTag: string | null;
  blurb: string;
};

/** Model id sent to the xAI API when Auto routes a hard coding task to Grok. */
export const GROK_MODEL_ID = "grok-4.7";

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "auto",
    label: "Auto",
    kind: "auto",
    ollamaTag: null,
    blurb:
      "Everyday coding stays on 7B. Hard coding goes to Grok. Games, ChiaLisp, Rust, and Rue stay on 32B.",
  },
  {
    id: "grok",
    label: "Grok",
    kind: "coding",
    ollamaTag: null,
    blurb: "Always send this job to the Grok API.",
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
    blurb: "Stronger coding when 32B is not pulled. Needs about 12GB.",
  },
  {
    id: "qwen2.5-coder:32b",
    label: "Coder 32B",
    kind: "coding",
    ollamaTag: "qwen2.5-coder:32b",
    blurb: "Best coding model for the 24GB RTX 3090. Needs about 20GB of VRAM.",
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
/**
 * Stronger default when Auto detects ChiaLisp / MTT / other hard domains.
 * The P720's 24GB RTX 3090 holds Q4 32B. Set AGENT_HARD_CODING_MODEL on the
 * worker if a box should escalate to a different tag.
 */
export const DEFAULT_HARD_CODING_MODEL = "qwen2.5-coder:32b";
export const DEFAULT_GENERAL_MODEL = "llama3.1:8b";
/** Better instruction-following for shopping / local research Q&A. */
export const DEFAULT_RESEARCH_GENERAL_MODEL = "qwen2.5:7b";

const CODING_HINT =
  /\b(code|coding|function|bug|fix|refactor|implement|typescript|javascript|python|rust|go\b|api|endpoint|class|module|commit|diff|pr\b|pull request|compile|lint|test|unit test|css|html|sql|docker|kubernetes|cli|script|repo|github|stack trace|error:|npm|cargo|pytest|build|game|app|website|page|component|ui|frontend|backend|playable|browser|canvas|sprite|unicorn|bubbles?|jump|platformer|make me|create a|write a|puzzle|chialisp|\.clsp|write_file|str_replace|screenshot_url|package\.json|index\.html|heading|h1)\b/i;

/** Short Studio follow-ups in an existing project ("change the heading"). */
const EDIT_FOLLOWUP_HINT =
  /\b(change|update|rename|edit|replace|find where|move|delete|add (a |the )?(button|link|heading|title|file|script|test)|overwrite)\b/i;

/** Checkpoint / continuity memory questions must stay on coder models (not Llama). */
const MEMORY_FOLLOWUP_HINT =
  /\b(what did we learn|last turn|checkpoint|open bugs|never ?do|files touched|verifyStatus|summarize.*(bug|decision|checkpoint))\b/i;

const RESEARCH_HINT =
  /\b(best|cheap|cheapest|affordable|lowest|compare|comparison|which|vs\b|versus|quote|quotes|buy|purchase|insurance|broker|price|cost|victoria|vancouver|icbc|how (do|should) i|where (do|can|should) i)\b/i;

const LOCAL_OVERRIDE =
  /\b(local only|ollama only|keep (it |this )?local|don'?t use grok|do not use grok)\b/i;

const GROK_OVERRIDE = /\b(use grok|send (this |it )?to grok|grok api)\b/i;

/** Score at which Auto sends a coding task to Grok instead of a local model. */
const HARD_TASK_THRESHOLD = 4;

/**
 * True when the worker should call the Grok API for this model id.
 * `grok` is the Studio choice; `grok-*` is a concrete xAI model id.
 */
export function isGrokTarget(model: string | null | undefined): boolean {
  if (!model) return false;
  const id = model.trim().toLowerCase();
  return id === "grok" || id.startsWith("grok-");
}

type TaskHit = { label: string; points: number; technical: boolean };

/**
 * Hard coding signals (stack traces, races, security, multi-file work).
 * Niche languages and playable games stay on the local 32B path.
 */
export function assessHardCoding(prompt: string): {
  hard: boolean;
  labels: string[];
  force: "local" | "grok" | null;
} {
  if (LOCAL_OVERRIDE.test(prompt)) {
    return { hard: false, labels: ["keep local"], force: "local" };
  }
  if (GROK_OVERRIDE.test(prompt)) {
    return { hard: true, labels: ["asked for Grok"], force: "grok" };
  }

  const hits: TaskHit[] = [];
  const add = (
    label: string,
    points: number,
    when: boolean,
    technical = true,
  ) => {
    if (when && points > 0) hits.push({ label, points, technical });
  };

  add(
    "stack trace or compiler failure",
    4,
    /traceback|stack trace|exception in thread|\bat [\w$.<>]+\s*\(.*:\d+:\d+\)|error TS\d{3,}|panic:|segfault|segmentation fault|FATAL ERROR/i.test(
      prompt,
    ),
  );
  add(
    "concurrency or memory bug",
    4,
    /race condition|data race|deadlock|memory leak|use-after-free|thread[- ]safety|heisenbug|undefined behavior/i.test(
      prompt,
    ),
  );
  add(
    "security review",
    4,
    /security audit|vulnerabilit|privilege escalation|\b(sql|command|prompt) injection\b|\bexploit\b|cryptographic|side[- ]channel/i.test(
      prompt,
    ),
  );
  add(
    "multi-file change",
    4,
    /across (the |multiple |several )?(files|modules|packages|services)|multi-file|multiple files|whole (codebase|repo|repository)|entire (codebase|repo|module)/i.test(
      prompt,
    ),
  );
  add(
    "migration",
    3,
    /\bmigrat(e|ion|ing)\b/i.test(prompt) &&
      /\b(schema|database|auth|codebase|service|architecture|storage)\b/i.test(
        prompt,
      ),
  );
  add(
    "system rewrite",
    3,
    /\brewrite\b/i.test(prompt) &&
      /\b(codebase|architecture|service|system|module)\b/i.test(prompt),
  );
  add(
    "hard-to-reproduce bug",
    3,
    /root cause|intermittent|flaky|can'?t reproduce|cannot reproduce|works locally but/i.test(
      prompt,
    ),
  );
  add(
    "performance work",
    2,
    /time complexity|space complexity|big-o|o\(n|hot path|profil(e|ing) this/i.test(
      prompt,
    ),
  );
  add(
    "stuck on a hard bug",
    2,
    /\b(i('| a)?m stuck|tried everything|hours on this|this is (really |too )?hard)\b/i.test(
      prompt,
    ),
  );

  const fencePairs = Math.floor((prompt.match(/```/g)?.length ?? 0) / 2);
  add("multiple code samples", 3, fencePairs >= 2, false);
  add(
    "several requirements",
    2,
    (prompt.match(/^\s*\d+[.)]\s+\S/gm)?.length ?? 0) >= 4,
    false,
  );
  add("large paste", 2, prompt.split("\n").length >= 100, false);
  add("long prompt", 2, prompt.length >= 3500, false);
  add("very long prompt", 2, prompt.length >= 8000, false);

  let score = hits.reduce((sum, hit) => sum + hit.points, 0);
  const technical = hits.some((hit) => hit.technical);
  const codeLike =
    CODING_HINT.test(prompt) ||
    prompt.includes("```") ||
    prompt.split("\n").length >= 100;
  if (technical && codeLike) score += 1;

  return {
    hard: score >= HARD_TASK_THRESHOLD && (technical || codeLike),
    labels: hits.map((hit) => hit.label),
    force: null,
  };
}

/**
 * Resolve Auto (or an explicit id) to an Ollama tag or a Grok model id.
 */
export function resolveModel(
  modelId: string | null | undefined,
  prompt: string,
  opts?: { preferCoding?: boolean; priorPrompt?: string; priorResult?: string },
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

  if ((option && option.id === "grok") || isGrokTarget(requested)) {
    const resolved = requested.toLowerCase().startsWith("grok-")
      ? requested
      : GROK_MODEL_ID;
    return {
      requested: option?.id || requested,
      resolved,
      reason: option ? `User selected ${option.label}` : `User selected ${resolved}`,
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

  const assessment = assessHardCoding(prompt);
  if (assessment.force === "grok" || assessment.hard) {
    const detail = assessment.labels.slice(0, 3).join(", ");
    return {
      requested: "auto",
      resolved: GROK_MODEL_ID,
      reason: detail
        ? `Auto: hard coding task (${detail}) → Grok`
        : "Auto: hard coding task → Grok",
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

  // A later turn in a game project ("try again", "still doesn't play") stays on 32B.
  const priorPlayable =
    Boolean(opts?.preferCoding) &&
    isPlayableGamePrompt(String(opts?.priorPrompt || "")) &&
    (isPlayableGamePrompt(prompt) ||
      /\b(try again|again|still|doesn'?t|does not|nothing|fix it|make it (?:work|play)|continue playing|can we play)\b/i.test(
        prompt,
      ));

  const priorFailed =
    Boolean(opts?.preferCoding) &&
    priorTurnNeedsStrongerModel(String(opts?.priorResult || ""));

  if (goal.hard || (goal.id === "coding" && escalate) || priorPlayable || priorFailed) {
    return {
      requested: "auto",
      resolved: DEFAULT_HARD_CODING_MODEL,
      reason: priorPlayable && !goal.hard
        ? `Auto: playable game follow-up → ${DEFAULT_HARD_CODING_MODEL}`
        : priorFailed && !goal.hard
          ? `Auto: previous turn failed → ${DEFAULT_HARD_CODING_MODEL}`
          : goal.hard
            ? `Auto: hard domain (${goal.label}) → ${DEFAULT_HARD_CODING_MODEL}`
            : `Auto: complex coding cues → ${DEFAULT_HARD_CODING_MODEL}`,
    };
  }

  const memoryQ = MEMORY_FOLLOWUP_HINT.test(prompt);
  const coding =
    goal.id === "coding" ||
    CODING_HINT.test(prompt) ||
    memoryQ ||
    (Boolean(opts?.preferCoding) && EDIT_FOLLOWUP_HINT.test(prompt)) ||
    (Boolean(opts?.preferCoding) && prompt.trim().length < 160) ||
    (Boolean(opts?.preferCoding) && memoryQ);
  if (coding) {
    return {
      requested: "auto",
      resolved: DEFAULT_CODING_MODEL,
      reason: memoryQ
        ? "Auto: checkpoint / memory question → coding model"
        : opts?.preferCoding
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
