/**
 * Knowledge packs for the on-prem worker (mirrors src/lib/knowledge/packs.ts).
 * Cross-platform: Windows, macOS, ChromeOS, Linux — not Ubuntu-only.
 */

export const KNOWLEDGE_CHUNKS = [
  {
    id: "cl-1",
    pack: "chialisp",
    title: "ChiaLisp basics",
    keywords: ["chialisp", "clvm", "chia", "puzzle", "solution", "sexp"],
    text: `ChiaLisp compiles to CLVM. Coins lock value behind a puzzle; spends provide a solution that must return conditions (CREATE_COIN, AGG_SIG_ME, ASSERT_*, …). Reason about parent coin id, puzzle hash, amount, and emitted conditions.`,
  },
  {
    id: "cl-2",
    pack: "chialisp",
    title: "Common conditions",
    keywords: [
      "condition",
      "create_coin",
      "agg_sig",
      "assert",
      "reserve_fee",
      "cat",
    ],
    text: `CREATE_COIN, AGG_SIG_ME/UNSAFE, ASSERT_MY_*, ASSERT_HEIGHT_*/SECONDS_*, RESERVE_FEE. CAT2 wraps an inner puzzle; burns send CATs to an unspendable burn puzzle hash.`,
  },
  {
    id: "cl-3",
    pack: "chialisp",
    title: "ChiaLisp pitfalls",
    keywords: ["chialisp", "bug", "pitfall", "curry", "treehash", "opcode"],
    text: `Curry bakes constants into puzzle hash; solution is spend-time. CLVM ints are not fixed-width. Prefer known opcodes. Assert expected puzzle hashes. Test with clvm/chia tools before claiming a spend works.`,
  },
  {
    id: "ops-nav",
    pack: "ops",
    title: "Cross-platform navigation habits",
    keywords: [
      "os",
      "operating",
      "system",
      "how",
      "install",
      "settings",
      "navigate",
      "computer",
      "laptop",
      "desktop",
      "file",
      "folder",
      "path",
    ],
    text: `Infer OS (Windows, macOS, ChromeOS, Linux) first. Give UI path then terminal/PowerShell. Prefer built-ins. One clear step sequence. Warn before admin/delete/security changes. If OS unknown, give Windows + macOS side by side.`,
  },
  {
    id: "ops-safe",
    pack: "ops",
    title: "Safe assistance rules",
    keywords: ["sudo", "admin", "password", "delete", "safe", "backup", "risk"],
    text: `Diagnostics before destruction. Never ask for passwords, recovery keys, or seed phrases. Call out irreversible steps. Prefer pasteable commands. Explain how to undo network/firewall/VPN changes.`,
  },
  {
    id: "win-1",
    pack: "windows",
    title: "Windows everyday navigation",
    keywords: [
      "windows",
      "win11",
      "win10",
      "pc",
      "powershell",
      "cmd",
      "explorer",
      "settings",
      "start menu",
      "task manager",
    ],
    text: `Windows: Win+I Settings, Win+E Explorer, Ctrl+Shift+Esc Task Manager. Install via Store or winget. %USERPROFILE% / %APPDATA%. Prefer PowerShell; quote paths with spaces.`,
  },
  {
    id: "win-2",
    pack: "windows",
    title: "Windows troubleshooting",
    keywords: [
      "windows",
      "defender",
      "firewall",
      "driver",
      "disk",
      "network",
      "wifi",
      "bluetooth",
      "permission",
    ],
    text: `Windows: Storage settings / Get-PSDrive; Network settings / ipconfig; Windows Security firewall; Apps → Repair/Reset; Run as administrator only when needed; WSL for Linux tools.`,
  },
  {
    id: "mac-1",
    pack: "macos",
    title: "macOS everyday navigation",
    keywords: [
      "macos",
      "mac",
      "osx",
      "apple",
      "finder",
      "spotlight",
      "brew",
      "terminal",
      "system settings",
    ],
    text: `macOS: Cmd+Space Spotlight; System Settings; Terminal; brew install; App Store or .dmg → /Applications; ~/Library/Application Support; Cmd+Shift+. shows hidden files.`,
  },
  {
    id: "mac-2",
    pack: "macos",
    title: "macOS troubleshooting",
    keywords: [
      "macos",
      "permission",
      "privacy",
      "gatekeeper",
      "disk",
      "wifi",
      "keychain",
      "activity monitor",
    ],
    text: `macOS: Cmd+Option+Esc force quit; Privacy & Security for permissions/Gatekeeper Open Anyway; Network settings; flush DNS with dscacheutil; do not assume apt/systemd.`,
  },
  {
    id: "cros-1",
    pack: "chromeos",
    title: "ChromeOS / Chromebook help",
    keywords: [
      "chromeos",
      "chromebook",
      "chrome os",
      "google chrome",
      "linux on chromeos",
      "crostini",
      "android apps",
    ],
    text: `ChromeOS: tray → Settings; Files app; Launcher key. Linux (Crostini) for apt packages; Play Store for Android when allowed. Managed school/work devices may block installs — mention early. Prefer PWA/web apps when desktop installs are unavailable.`,
  },
  {
    id: "cros-2",
    pack: "chromeos",
    title: "Chrome browser tasks (any OS)",
    keywords: [
      "chrome",
      "browser",
      "extension",
      "bookmark",
      "profile",
      "chrome://",
      "clear cache",
      "cookies",
    ],
    text: `Chrome anywhere: chrome://settings, chrome://extensions; manage profiles via avatar; Delete browsing data; Downloads folder; site permissions via lock icon. Clear one site's cookies before a full reset.`,
  },
  {
    id: "linux-1",
    pack: "linux",
    title: "Linux packages & services",
    keywords: [
      "linux",
      "ubuntu",
      "debian",
      "fedora",
      "arch",
      "apt",
      "dnf",
      "pacman",
      "systemd",
      "distro",
    ],
    text: `Linux: apt (Debian/Ubuntu), dnf (Fedora), pacman (Arch). systemctl + journalctl for services. Identify with /etc/os-release.`,
  },
  {
    id: "linux-2",
    pack: "linux",
    title: "Linux files, network, permissions",
    keywords: [
      "chmod",
      "chown",
      "firewall",
      "ufw",
      "firewalld",
      "disk",
      "ssh",
      "port",
      "linux",
    ],
    text: `Linux: ls/chown/chmod; df/du; ss/lsof ports; ufw or firewalld; SSH key modes 700/600.`,
  },
  {
    id: "ev-1",
    pack: "everyday",
    title: "Everyday Q&A standards",
    keywords: [
      "what",
      "why",
      "who",
      "when",
      "explain",
      "mean",
      "difference",
      "should",
      "opinion",
      "news",
      "fact",
    ],
    text: `Everyday questions: direct answer first; separate facts from contested claims; fair summary of major views; web_search for time-sensitive facts; no invented stats; medical/legal/financial = general info + professionals when stakes are high.`,
  },
  {
    id: "pb-1",
    pack: "playbook",
    title: "Agent playbook",
    keywords: ["plan", "patch", "test", "project", "step", "help"],
    text: `Restate goal → identify OS for system tasks → search when menus may have changed → smallest change → one project step at a time → risks + next action.`,
  },
];

export function retrieveKnowledge(query, opts = {}) {
  const limit = opts.limit ?? 4;
  const allow = opts.packs ? new Set(opts.packs) : null;
  const tokens = String(query)
    .toLowerCase()
    .split(/[^a-z0-9.+#-]+/)
    .filter((t) => t.length > 2);

  return KNOWLEDGE_CHUNKS.filter((c) => !allow || allow.has(c.pack))
    .map((chunk) => {
      let score = 0;
      for (const t of tokens) {
        if (chunk.keywords.some((k) => k.includes(t) || t.includes(k)))
          score += 3;
        if (chunk.title.toLowerCase().includes(t)) score += 2;
        if (chunk.text.toLowerCase().includes(t)) score += 1;
      }
      return { chunk, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk }) => ({
      id: chunk.id,
      title: chunk.title,
      text: chunk.text,
    }));
}

export function packsForProfile(profile) {
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
