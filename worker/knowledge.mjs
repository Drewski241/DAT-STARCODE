/**
 * Knowledge packs for the on-prem worker (mirrors src/lib/knowledge/packs.ts).
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
    text: `apt update/install; systemctl status|start|restart|enable; journalctl -u UNIT -e; DEBIAN_FRONTEND=noninteractive for scripts; lsb_release -a; uname -a.`,
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
    text: `ls -la; chown/chmod carefully; df -h; ss -tlnp; ufw status; SSH key modes 700/600. Prefer diagnostics before destructive commands.`,
  },
  {
    id: "ops-1",
    pack: "ops",
    title: "Safe shell guidance",
    keywords: ["shell", "bash", "command", "sudo", "script", "safe"],
    text: `Read-only diagnostics first. Explain sudo. Note irreversible steps. Call out distro package manager differences (apt/dnf/pacman).`,
  },
  {
    id: "pb-1",
    pack: "playbook",
    title: "Agent playbook",
    keywords: ["plan", "patch", "test", "project", "step"],
    text: `Restate goal → search when facts may be stale → smallest change → for projects finish only the current step → end with risks and next action.`,
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
      return ["ubuntu", "ops", "playbook"];
    case "coding":
      return ["playbook"];
    default:
      return ["playbook", "ops"];
  }
}
