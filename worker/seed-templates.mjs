/**
 * Seed curated template trees into an agent workspace.
 * Missing paths are written; treasury .clsp that cannot cdv-build
 * (no sha256tree include) are refreshed from templates.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

async function writeFile(root, rel, body, written, log, { force = false } = {}) {
  const to = path.join(root, rel);
  if (!force) {
    try {
      await fs.access(to);
      return;
    } catch {
      /* missing */
    }
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.writeFile(to, body, "utf8");
  written.push(rel);
  log(`[seed] ${force ? "refreshed" : "wrote"} ${rel}`);
}

async function needsClspRefresh(root, rel) {
  try {
    const body = await fs.readFile(path.join(root, rel), "utf8");
    // Pre-fix templates used bare sha256tree / quotient and fail cdv build.
    if (!/\(include\s+sha256tree\.clib\)/i.test(body)) return true;
    if (/\bquotient\b/i.test(body)) return true;
    return false;
  } catch {
    return true; // missing → write
  }
}

/**
 * @param {string} root workspace root
 * @param {string} goalId
 * @param {{ log?: Function }} [opts]
 * @returns {Promise<string[]>}
 */
export async function seedTemplatesForGoal(root, goalId, opts = {}) {
  const log = opts.log || (() => {});
  if (goalId !== "secure_treasury") return [];

  const base = path.join(repoRoot, "templates", "secure-treasury");
  const written = [];

  const always = [
    ["VULNERABILITY.md", "VULNERABILITY.md", false],
    ["PLAN.md", "PLAN.md", false],
    ["README.md", "README.md", false],
    ["docs/SECURITY.md", "docs/SECURITY.md", false],
    ["tests/spend-samples.json", "tests/spend-samples.json", false],
    // Always refresh include — required for cdv.
    ["include/sha256tree.clib", "include/sha256tree.clib", true],
    [
      "include/sha256tree.clib",
      "templates/secure-treasury/include/sha256tree.clib",
      true,
    ],
  ];

  for (const [fromRel, toRel, force] of always) {
    try {
      const body = await fs.readFile(path.join(base, fromRel), "utf8");
      await writeFile(root, toRel, body, written, log, { force });
    } catch (err) {
      log(
        `[seed] skip ${fromRel}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const puzzles = [
    ["puzzles/savings_vault.clsp", "puzzles/savings_vault.clsp"],
    ["puzzles/treasury_coin.clsp", "puzzles/treasury_coin.clsp"],
    ["puzzles/interest_payout.clsp", "puzzles/interest_payout.clsp"],
    [
      "puzzles/savings_vault.clsp",
      "templates/secure-treasury/puzzles/savings_vault.clsp",
    ],
    [
      "puzzles/treasury_coin.clsp",
      "templates/secure-treasury/puzzles/treasury_coin.clsp",
    ],
    [
      "puzzles/interest_payout.clsp",
      "templates/secure-treasury/puzzles/interest_payout.clsp",
    ],
  ];

  for (const [fromRel, toRel] of puzzles) {
    try {
      const body = await fs.readFile(path.join(base, fromRel), "utf8");
      const force = await needsClspRefresh(root, toRel);
      await writeFile(root, toRel, body, written, log, { force });
    } catch (err) {
      log(
        `[seed] skip ${fromRel}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return written;
}
