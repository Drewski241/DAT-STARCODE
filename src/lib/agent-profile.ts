import type { AgentProfile } from "@/lib/types";
import type { KnowledgePack } from "@/lib/knowledge/packs";

const CHIALISP_HINT =
  /\b(chialisp|clvm|chia\b|coinset|puzzle hash|curry|agg_sig|create_coin|cat2?\b|offer\b|coin_id|softfork|treasury|savings\s*vault|circuit)\b/i;

/** How-to / navigate-my-computer style tasks across major OSes. */
const OPS_HINT =
  /\b(ubuntu|debian|fedora|arch\b|centos|rhel|apt\b|dnf\b|pacman|systemd|journalctl|ssh\b|ufw\b|nginx|docker|kernel|linux|windows|win11|win10|powershell|cmd\.exe|winget|macos|mac\b|osx|finder|spotlight|homebrew|\bbrew\b|chromeos|chromebook|chrome os|crostini|google chrome|browser settings|task manager|file explorer|system settings|how do i|how to (install|open|find|enable|disable|clear|reset|connect|update)|my (pc|computer|laptop|mac|chromebook))\b/i;

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
      return "Systems help";
    case "coding":
      return "Coding";
    default:
      return "General";
  }
}

/** Which knowledge packs to retrieve for a profile. */
export function packsForProfile(profile: AgentProfile): KnowledgePack[] {
  switch (profile) {
    case "chialisp":
      return ["chialisp", "playbook"];
    case "ops":
      return ["ops", "windows", "macos", "chromeos", "linux", "playbook"];
    case "coding":
      return ["playbook", "ops"];
    default:
      return ["everyday", "playbook", "ops"];
  }
}
