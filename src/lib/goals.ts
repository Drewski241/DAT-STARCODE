/**
 * Lightweight goal inference for Studio / pricing / Auto model routing.
 * Keep regexes aligned with worker/goals.mjs.
 */

export type GoalId =
  | "mtt_pool"
  | "secure_treasury"
  | "chialisp"
  | "coding"
  | "general";

export type InferredGoal = {
  id: GoalId;
  label: string;
  /** Needs ChiaLisp playbook / more steps / stronger model */
  hard: boolean;
};

const MTT_HINT =
  /\b(mtt_pool|mtt\b|tournament\s*pool|pool\s*coin|buy-?ins?\b.*payout|payout.*buy-?ins?|top\s*three|top\s*3)\b/i;
const TREASURY_HINT =
  /\b(treasury|savings\s*vault|discounted_balance|circuit\s*dao|byc\b|flash-?loan.*interest|interest.*treasury)\b/i;
const CHIALISP_HINT =
  /\b(\.clsp|chialisp|chia\s*lisp|clvm|pool\s*coin|mtt_pool|puzzle\s*hash|agg_sig|create_coin)\b/i;
const PUZZLE_WORD = /\bpuzzles?\b/i;
const CODING_HINT =
  /\b(code|coding|function|bug|fix|refactor|implement|typescript|javascript|python|rust|go\b|api|endpoint|class|module|commit|diff|pr\b|pull request|compile|lint|test|unit test|css|html|sql|docker|cli|script|repo|github|build|game|app|website|component|ui|frontend|backend|puzzles?|curry|treehash)\b/i;

export function inferGoal(prompt: string): InferredGoal {
  const text = String(prompt || "");
  const chia = CHIALISP_HINT.test(text);
  const mtt = MTT_HINT.test(text);
  const treasury = TREASURY_HINT.test(text);
  const treasuryWork =
    treasury ||
    /\b(savings_vault|treasury_coin|secure_treasury|interest_payout)\b/i.test(
      text,
    );

  // Prefer treasury over MTT when both match (e.g. "delete MTT stub … savings_vault").
  if (treasuryWork) {
    return {
      id: "secure_treasury",
      label: "Secure treasury / savings vault",
      hard: true,
    };
  }
  if (mtt && (chia || /\bpuzzles?|clsp|chia|pool\b/i.test(text))) {
    return {
      id: "mtt_pool",
      label: "MTT pool / tournament coin",
      hard: true,
    };
  }
  if (
    chia ||
    (PUZZLE_WORD.test(text) &&
      /\b(compromised|vulnerab|exploit|drain|secur(?:e|ity)|chialisp|clvm|create_coin|agg_sig|summarize|summary)\b/i.test(
        text,
      ))
  ) {
    return {
      id: "chialisp",
      label: "ChiaLisp / CLVM puzzle",
      hard: true,
    };
  }
  if (CODING_HINT.test(text)) {
    return { id: "coding", label: "Coding task", hard: false };
  }
  return { id: "general", label: "General", hard: false };
}

export function isHardDomainPrompt(prompt: string): boolean {
  return inferGoal(prompt).hard;
}
