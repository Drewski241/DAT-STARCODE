/**
 * Curated knowledge packs retrieved into the agent context.
 * Keep chunks short — small local models have limited context.
 */

export type KnowledgeChunk = {
  id: string;
  pack: "chialisp" | "ubuntu" | "ops" | "playbook";
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
- Test with clvm / chia dev tools before claiming a spend works.`,
  },
  {
    id: "ub-1",
    pack: "ubuntu",
    title: "Ubuntu package & service basics",
    keywords: [
      "ubuntu",
      "apt",
      "systemd",
      "service",
      "debian",
      "linux",
      "package",
    ],
    text: `Ubuntu/Debian ops basics:
- Update indexes: sudo apt update
- Install: sudo apt install <pkg>
- Services: systemctl status|start|stop|restart|enable <unit>
- Logs: journalctl -u <unit> -e
- Prefer non-interactive flags in scripts: DEBIAN_FRONTEND=noninteractive
- Check OS: lsb_release -a ; uname -a`,
  },
  {
    id: "ub-2",
    pack: "ubuntu",
    title: "Permissions, networking, disks",
    keywords: [
      "chmod",
      "chown",
      "firewall",
      "ufw",
      "disk",
      "df",
      "ssh",
      "port",
    ],
    text: `Common Ubuntu troubleshooting:
- Permissions: ls -la ; sudo chown user:user file ; chmod 644/755 as appropriate
- Disk: df -h ; du -sh *
- Ports: ss -tlnp or sudo lsof -i :<port>
- Firewall: sudo ufw status ; allow only what you need
- SSH: check sshd, ~/.ssh/authorized_keys modes (700/600)`,
  },
  {
    id: "ops-1",
    pack: "ops",
    title: "Safe shell guidance",
    keywords: ["shell", "bash", "command", "sudo", "script", "safe"],
    text: `When helping with any OS:
- Prefer read-only diagnostics before destructive commands
- Explain what a command does before sudo
- Offer copy-pasteable commands with expected output
- Call out irreversible steps (rm -rf, disk format, firewall lockout)
- Note distro differences (apt vs dnf vs pacman) when relevant`,
  },
  {
    id: "pb-1",
    pack: "playbook",
    title: "Agent playbook",
    keywords: ["plan", "patch", "test", "project", "step"],
    text: `DAT STARCODER playbook:
1. Restate the goal and acceptance checks
2. Search docs or the web when facts may be stale
3. Prefer smallest change; show concrete commands or patches
4. For multi-step projects, finish the current step only — do not skip ahead
5. End with residual risks and a clear next action`,
  },
];

/** Score chunks for a query; return top-k text blocks. */
export function retrieveKnowledge(
  query: string,
  opts?: { limit?: number; packs?: KnowledgeChunk["pack"][] },
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
