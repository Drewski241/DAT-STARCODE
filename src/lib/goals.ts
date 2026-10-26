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
  /\b(treasury|savings\s*vault|discounted_balance|circuit\s*dao|byc\b|flash-?loan.*interest|interest.*treasury|owner-?bound|real\s*funds|singleton|treasur(?:y)?_pk|interest_payout)\b/i;
const REAL_FUNDS_HINT =
  /\b(real\s*funds|mainnet|owner-?bound|owner_pk|treasury_pk|singleton|cat2?\b|production\s*(?:ready|hardening)|external\s*review)\b/i;
const CHIALISP_HINT =
  /\b(\.clsp|chialisp|chia\s*lisp|clvm|pool\s*coin|mtt_pool|puzzle\s*hash|agg_sig|create_coin)\b/i;
const PUZZLE_WORD = /\bpuzzles?\b/i;
const CODING_HINT =
  /\b(code|coding|function|bug|fix|refactor|implement|typescript|javascript|python|rust|go\b|api|endpoint|class|module|commit|diff|pr\b|pull request|compile|lint|test|unit test|css|html|sql|docker|cli|script|repo|github|build|game|app|website|component|ui|frontend|backend|puzzles?|curry|treehash|write_file|str_replace|screenshot_url|package\.json|index\.html|heading|h1|change the|find where|last turn|checkpoint|open bugs)\b/i;
const WEB_APP_HINT =
  /\b(next\.?js|react|website|web\s*app|landing\s*page|tailwind|vercel|hydration|npm\s+run\s+(?:dev|build)|create-next-app|frontend)\b/i;
const ERROR_FIX_HINT =
  /\b(fix\s+this|build\s+failed|failed\s+to\s+compile|typeerror|cannot\s+find\s+module|npm\s+err|stack\s+trace|TS\d{4}|help.*error)\b/i;
const DEPLOY_HINT =
  /\b(amplify|redeploy|deploy\s+to\s+(prod|production|amplify)|push\s+to\s+github|customer-workspaces)\b/i;
const PROD_DEBUG_HINT =
  /\b(production|prod\s+log|amplify\s+build|worker\s+401|credentialprovidererror|walletconnect\s+offline)\b/i;
const MULTI_FILE_HINT =
  /\b(refactor|multi-?file|across\s+files|next\.js|react\s+app|migrate|typescript\s+project)\b/i;

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
  if (treasuryWork || REAL_FUNDS_HINT.test(text)) {
    const realFunds = REAL_FUNDS_HINT.test(text);
    return {
      id: "secure_treasury",
      label: realFunds
        ? "Secure treasury → real-funds hardening"
        : "Secure treasury / savings vault",
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
  if (
    CODING_HINT.test(text) ||
    WEB_APP_HINT.test(text) ||
    ERROR_FIX_HINT.test(text) ||
    DEPLOY_HINT.test(text) ||
    PROD_DEBUG_HINT.test(text)
  ) {
    const errorFix = ERROR_FIX_HINT.test(text);
    const web = WEB_APP_HINT.test(text);
    const deploy = DEPLOY_HINT.test(text);
    const prod = PROD_DEBUG_HINT.test(text);
    const multi = MULTI_FILE_HINT.test(text);
    const benignOnly =
      errorFix &&
      /Gtk-Message:|atk-bridge|xdg-open|desktop browser/i.test(text) &&
      !/Cannot find module|Failed to compile|TypeError|TS\d{4}|MODULE_NOT_FOUND|exit [1-9]/i.test(
        text,
      );
    return {
      id: "coding",
      label: benignOnly
        ? "Web app / website"
        : deploy
          ? "Deploy / Amplify"
          : prod
            ? "Prod / runtime debug"
            : errorFix
              ? "Fix build / runtime error"
              : web
                ? "Web app / website"
                : multi
                  ? "Multi-file coding"
                  : "Coding task",
      hard: (errorFix && !benignOnly) || multi || deploy || prod,
    };
  }
  return { id: "general", label: "General", hard: false };
}

export function isHardDomainPrompt(prompt: string): boolean {
  return inferGoal(prompt).hard;
}
