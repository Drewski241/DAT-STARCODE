import type { AgentProfile } from "@/lib/types";

const CHIALISP_HINT =
  /\b(chialisp|clvm|chia\b|coinset|puzzle hash|curry|agg_sig|create_coin|cat2?\b|offer\b|coin_id|softfork)\b/i;

const OPS_HINT =
  /\b(ubuntu|debian|fedora|arch\b|centos|rhel|apt\b|dnf\b|pacman|systemd|journalctl|ssh\b|ufw\b|nginx|docker|kernel|linux|windows server|macos|brew\b)\b/i;

const CODING_HINT =
  /\b(code|coding|function|bug|fix|refactor|implement|typescript|javascript|python|rust|go\b|api|endpoint|class|module|commit|diff|pr\b|pull request|compile|lint|test|unit test|css|html|sql|cli|script|repo|github|stack trace|npm|cargo|pytest)\b/i;

export function detectAgentProfile(prompt: string): AgentProfile {
  if (CHIALISP_HINT.test(prompt)) return "chialisp";
  if (OPS_HINT.test(prompt)) return "ops";
  if (CODING_HINT.test(prompt)) return "coding";
  return "general";
}

export function profileLabel(profile: AgentProfile): string {
  switch (profile) {
    case "chialisp":
      return "ChiaLisp";
    case "ops":
      return "OS / ops";
    case "coding":
      return "Coding";
    default:
      return "General";
  }
}

export function packsForProfile(
  profile: AgentProfile,
): Array<"chialisp" | "ubuntu" | "ops" | "playbook"> {
  switch (profile) {
    case "chialisp":
      return ["chialisp", "playbook"];
    case "ops":
      return ["ubuntu", "ops", "playbook"];
    case "coding":
      return ["playbook"];
    default:
      return ["playbook", "ops"];
  }
}
