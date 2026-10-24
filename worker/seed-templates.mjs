/**
 * Seed curated template trees into an agent workspace (skip existing paths).
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");

async function writeIfMissing(root, rel, body, written, log) {
  const to = path.join(root, rel);
  try {
    await fs.access(to);
    return;
  } catch {
    /* missing */
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.writeFile(to, body, "utf8");
  written.push(rel);
  log(`[seed] wrote ${rel}`);
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
  const files = [
    ["VULNERABILITY.md", "VULNERABILITY.md"],
    ["PLAN.md", "PLAN.md"],
    ["README.md", "README.md"],
    ["docs/SECURITY.md", "docs/SECURITY.md"],
    ["puzzles/savings_vault.clsp", "puzzles/savings_vault.clsp"],
    ["puzzles/treasury_coin.clsp", "puzzles/treasury_coin.clsp"],
    [
      "puzzles/savings_vault.clsp",
      "templates/secure-treasury/puzzles/savings_vault.clsp",
    ],
    [
      "puzzles/treasury_coin.clsp",
      "templates/secure-treasury/puzzles/treasury_coin.clsp",
    ],
  ];

  for (const [fromRel, toRel] of files) {
    try {
      const body = await fs.readFile(path.join(base, fromRel), "utf8");
      await writeIfMissing(root, toRel, body, written, log);
    } catch (err) {
      log(
        `[seed] skip ${fromRel}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return written;
}
