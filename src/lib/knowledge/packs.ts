/**
 * Curated knowledge packs retrieved into the agent context.
 * Keep chunks short — small local models have limited context.
 * OS packs cover Windows, macOS, ChromeOS, and major Linux distros.
 */

export type KnowledgePack =
  | "chialisp"
  | "linux"
  | "windows"
  | "macos"
  | "chromeos"
  | "ops"
  | "everyday"
  | "playbook";

export type KnowledgeChunk = {
  id: string;
  pack: KnowledgePack;
  title: string;
  text: string;
  keywords: string[];
};

export const KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [
  {
    id: "cl-1",
    pack: "chialisp",
    title: "ChiaLisp basics",
    keywords: ["chialisp", "clvm", "chia", "puzzle", "solution", "sexp"],
    text: `ChiaLisp compiles to CLVM (Chia Lisp Virtual Machine). Programs are S-expressions.
A coin locks value behind a puzzle (program). Spending provides a solution; the puzzle
must return a list of conditions (CREATE_COIN, AGG_SIG_ME, ASSERT_*, etc.).
Always reason about: parent coin id, puzzle hash, amount, and the conditions emitted.`,
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
    text: `Frequently used conditions:
- CREATE_COIN puzzle_hash amount … — mint/send a new coin
- AGG_SIG_ME / AGG_SIG_UNSAFE — require a signature
- ASSERT_MY_COIN_ID / ASSERT_MY_AMOUNT / ASSERT_MY_PUZZLEHASH — bind identity
- ASSERT_CONCURRENT_SPEND / ASSERT_HEIGHT_* / ASSERT_SECONDS_* — timing & concurrency
- RESERVE_FEE — fee from this spend
CAT2 wraps an inner puzzle; burns send the CAT to an unspendable burn puzzle hash.`,
  },
  {
    id: "cl-3",
    pack: "chialisp",
    title: "ChiaLisp pitfalls",
    keywords: ["chialisp", "bug", "pitfall", "curry", "treehash", "opcode"],
    text: `Pitfalls:
- Currying vs solution args: curry bakes constants into the puzzle hash; solution is spend-time.
- Integer encoding: CLVM ints are not fixed-width; be careful with amount bytes in coin_id.
- Softfork / unknown ops: prefer well-known opcodes for mainnet compatibility.
- Never trust client-supplied puzzle hashes without asserting what you expect.
- Test with clvm_verify (brun/run) before claiming a spend works.`,
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
    text: `When helping someone use their computer:
1. Ask or infer the OS (Windows, macOS, ChromeOS, Linux distro) before giving clicks/commands.
2. Give UI path first ("Settings → …"), then the terminal/PowerShell equivalent if useful.
3. Prefer built-in tools over third-party downloads unless needed.
4. One clear sequence of steps; say what they should see after each.
5. Warn before admin/password prompts, deleting files, or changing network/security settings.
6. If OS is unknown, give the Windows + macOS paths side by side, then Linux/ChromeOS if relevant.`,
  },
  {
    id: "ops-safe",
    pack: "ops",
    title: "Safe assistance rules",
    keywords: ["sudo", "admin", "password", "delete", "safe", "backup", "risk"],
    text: `Safety for any OS:
- Diagnostics before destructive changes
- Never ask for passwords, recovery keys, or seed phrases
- Call out irreversible steps (format disk, reset OS, wipe browser profile)
- Prefer "Open Terminal/PowerShell and paste this" over opaque scripts
- For network/firewall/VPN changes, explain how to undo`,
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
    text: `Windows (10/11) navigation:
- Settings: Win+I · File Explorer: Win+E · Run: Win+R · Task Manager: Ctrl+Shift+Esc
- Install apps: Microsoft Store, or winget install <id> in PowerShell / Windows Terminal
- List installs: winget list · Updates: Settings → Windows Update
- Services: services.msc · Startup apps: Task Manager → Startup apps
- Paths: %USERPROFILE%, %APPDATA%, %LOCALAPPDATA%
- Prefer PowerShell over cmd for modern help; quote paths with spaces`,
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
    text: `Windows troubleshooting:
- Disk: Settings → System → Storage · PowerShell: Get-PSDrive
- Network: Settings → Network & internet · ipconfig /all · Reset: netsh winsock reset (reboot)
- Firewall: Windows Security → Firewall & network protection
- Apps misbehaving: Settings → Apps → Installed apps → Repair/Reset
- Permissions: right-click → Properties → Security; for terminals run "Run as administrator" only when needed
- WSL: wsl --status / wsl --install for Linux tools on Windows`,
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
    text: `macOS navigation:
- Spotlight: Cmd+Space · Finder: Cmd+Option+Space or Dock · System Settings: Apple menu → System Settings
- Terminal: Applications → Utilities → Terminal (or iTerm)
- Install CLI tools: Homebrew — brew install <pkg> ; brew update ; brew upgrade
- App installs: App Store, or drag .app to /Applications from a .dmg
- Paths: ~, ~/Library/Application Support, /Applications
- Show hidden files in Finder: Cmd+Shift+.`,
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
    text: `macOS troubleshooting:
- Force quit: Cmd+Option+Esc · Activity Monitor for CPU/memory
- Disk: Apple menu → About This Mac → More Info → Storage Settings · df -h in Terminal
- Privacy prompts: System Settings → Privacy & Security (Full Disk Access, Files and Folders, Accessibility)
- Blocked app: Privacy & Security → Open Anyway (Gatekeeper)
- Network: System Settings → Network · Wi‑Fi details · flush DNS: sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
- Keep advice distinct from Linux apt/systemd unless the user is in a VM/container`,
  },
  {
    id: "cros-1",
    pack: "chromeos",
    title: "ChromeOS / Chromebook help",
    keywords: [
      "chromeos",
      "chromebook",
      "chrome os",
      "chromeos",
      "google chrome",
      "chromebook",
      "linux on chromeos",
      "crostini",
      "android apps",
    ],
    text: `ChromeOS / Chromebook:
- Settings: bottom-right time → Settings gear (or chrome://settings)
- Files app for Downloads, Google Drive, USB
- Shortcuts: Search/Launcher key opens apps; Ctrl+T new tab; Ctrl+Shift+T reopen tab
- Linux (Crostini): Settings → About ChromeOS → Developers → Linux development environment — then apt inside the Linux terminal
- Android apps: Google Play Store when enabled by the device/admin
- Many "install a desktop app" answers need Linux or a web/PWA alternative on ChromeOS
- School/work managed devices may block Linux, Play Store, or installs — say so early`,
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
    text: `Google Chrome tasks (Windows, Mac, ChromeOS, Linux):
- Settings: chrome://settings · Extensions: chrome://extensions · Flags: chrome://flags (warn: experimental)
- Profiles: top-right avatar → manage profiles
- Clear browsing data: Settings → Privacy and security → Delete browsing data
- Default download folder: Settings → Downloads
- Site permissions: lock icon in address bar → Site settings
- Reset stubborn site: clear cookies for that site only before a full browser reset`,
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
    text: `Linux (pick the package manager for their distro):
- Debian/Ubuntu: sudo apt update && sudo apt install <pkg>
- Fedora/RHEL: sudo dnf install <pkg>
- Arch: sudo pacman -S <pkg>
- Services (systemd): systemctl status|start|stop|restart|enable <unit>
- Logs: journalctl -u <unit> -e
- Identity: uname -a ; (Ubuntu) lsb_release -a ; (Fedora) cat /etc/os-release
- Scripts: DEBIAN_FRONTEND=noninteractive only on apt-based images`,
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
    text: `Linux troubleshooting:
- Permissions: ls -la ; sudo chown user:user file ; chmod 644/755 as appropriate
- Disk: df -h ; du -sh *
- Ports: ss -tlnp or sudo lsof -i :<port>
- Firewall: ufw (Ubuntu) or firewalld (Fedora) — status before opening ports
- SSH: ~/.ssh at 700, private keys 600; check sshd if remote access fails`,
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
    text: `Everyday questions:
- Lead with the direct answer, then brief context
- Separate established facts from contested claims; note uncertainty
- For contested social/political topics, summarize leading positions fairly without taking a side unless asked for a personal recommendation
- Prefer primary/reputable sources via web_search for time-sensitive facts
- Do not moralize, scare, or sell; do not invent statistics
- Medical/legal/financial: general info only + suggest professionals when decisions matter
- Never tell the user to Google it — research with web_search/fetch_url and give concrete local steps
- For BC vehicles/motorcycles, start with ICBC (basic) then licensed brokers for optional coverage; do not invent premiums
- If the question needs the user's OS or locale, ask one clarifying question`,
  },
  {
    id: "ev-2",
    pack: "everyday",
    title: "Local how-to research pattern",
    keywords: [
      "insurance",
      "victoria",
      "bc",
      "broker",
      "licence",
      "license",
      "city",
      "local",
      "motorcycle",
      "quote",
    ],
    text: `Local how-tos: include city + province/state in search queries; prefer official .gov / crown corp pages; list documents needed; give phone/online/in-person paths; end with ## Next steps the user can do today. Insurance/legal is guidance only — recommend a licensed broker/agent for binding quotes. For best/cheapest: compare purchase paths; never invent premiums or remix URLs.`,
  },
  {
    id: "ev-bc-moto",
    pack: "everyday",
    title: "BC motorcycle insurance orientation",
    keywords: [
      "icbc",
      "motorcycle",
      "bike",
      "victoria",
      "bc",
      "autoplan",
      "sport",
      "300cc",
      "insurance",
    ],
    text: `British Columbia: basic Autoplan motorcycle insurance is through ICBC (sold via Autoplan brokers/agents). Optional coverages may be ICBC and/or other insurers — verify via fetch_url. Sport bikes / new riders often raise optional premiums. Cheapest honest path: licence class check → ICBC basic quote with VIN → two same-day optional quotes → compare total + deductibles. Never invent dollar amounts.`,
  },
  {
    id: "pb-1",
    pack: "playbook",
    title: "Agent playbook",
    keywords: ["plan", "patch", "test", "project", "step", "help"],
    text: `DAT STARCODER playbook:
1. Restate the goal and acceptance checks
2. Identify the user's OS/environment when the task is system navigation
3. Search the web when facts may be stale (versioned Settings menus change)
4. Prefer smallest change; show concrete UI paths or commands
5. For multi-step projects, finish the current step only
6. End with residual risks and a clear next action`,
  },
];

/** Score chunks for a query; return top-k text blocks. */
export function retrieveKnowledge(
  query: string,
  opts?: { limit?: number; packs?: KnowledgePack[] },
): { id: string; title: string; text: string }[] {
  const limit = opts?.limit ?? 4;
  const allow = opts?.packs ? new Set(opts.packs) : null;
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9.+#-]+/)
    .filter((t) => t.length > 2);

  const scored = KNOWLEDGE_CHUNKS.filter(
    (c) => !allow || allow.has(c.pack),
  ).map((chunk) => {
    let score = 0;
    for (const t of tokens) {
      if (chunk.keywords.some((k) => k.includes(t) || t.includes(k))) score += 3;
      if (chunk.title.toLowerCase().includes(t)) score += 2;
      if (chunk.text.toLowerCase().includes(t)) score += 1;
    }
    return { chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ chunk }) => ({
      id: chunk.id,
      title: chunk.title,
      text: chunk.text,
    }));
}
