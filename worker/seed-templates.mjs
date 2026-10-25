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

function defunBody(s, name) {
  const re = new RegExp(`\\(defun\\s+${name}\\b`, "i");
  const m = re.exec(s);
  if (!m) return "";
  let i = m.index;
  let depth = 0;
  for (; i < s.length; i++) {
    if (s[i] === "(") depth += 1;
    else if (s[i] === ")") {
      depth -= 1;
      if (depth === 0) return s.slice(m.index, i + 1);
    }
  }
  return s.slice(m.index);
}

async function needsClspRefresh(root, rel) {
  try {
    const body = await fs.readFile(path.join(root, rel), "utf8");
    const code = body
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return t.length > 0 && !t.startsWith(";");
      })
      .join("\n")
      .trimStart();
    // Must start with (mod — include-before-mod is a common 14b corruption.
    if (!code.startsWith("(mod")) return true;
    // Prefer inlined sha256tree (no include dependency for cdv).
    if (!/\(defun\s+sha256tree\b/i.test(body)) return true;
    if (/\bquotient\b/i.test(body)) return true;
    // v2: owner-bound payout (no free dest_ph in code).
    const codeOnly = body.replace(/;.*$/gm, "\n");
    if (/interest_payout\.clsp$/i.test(rel)) {
      if (!/\bOWNER_PH\b/.test(codeOnly) || /\bdest_ph\b/i.test(codeOnly)) {
        return true;
      }
      // claim-msg (owed) closing over free OWNER_PH → cdv "clvm raise"
      // (Studio zip a5e8ee26 / 8b6c5e70 stale templates/ mirror).
      if (/\(defun\s+claim-msg\s*\(\s*owed\s*\)/i.test(codeOnly)) {
        return true;
      }
    }
    if (/treasury_coin\.clsp$/i.test(rel)) {
      if (/\bdest_ph\b/i.test(codeOnly) && !/\bOWNER_PH\b/.test(codeOnly)) {
        return true;
      }
    }
    // v2: mode-4 claim-only must reset DEPOSIT_SECONDS := now_seconds.
    if (/savings_vault\.clsp$/i.test(rel)) {
      const claim = defunBody(body, "mode-claim-only");
      if (claim && /PRINCIPAL\s+DEPOSIT_SECONDS\s+OWNER_PH/i.test(claim)) {
        return true;
      }
      // v2: claim-msg must bind OWNER_PH (not a free dest_ph arg).
      const cm = defunBody(body, "claim-msg");
      if (cm && /\bdest_ph\b/i.test(cm)) return true;
      if (cm && !/\bOWNER_PH\b/.test(cm) && !/\bowner\b/i.test(cm)) {
        return true;
      }
      // Nullary mode defuns that close over mod params break cdv/brun.
      if (/\(defun\s+mode-(?:open|withdraw|claim-only)\s*\(\s*\)/i.test(codeOnly)) {
        return true;
      }
    }
    if (/treasury_coin\.clsp$/i.test(rel)) {
      if (/\(defun\s+pay-interest\s*\(\s*\)/i.test(codeOnly)) return true;
    }
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
    // Always refresh real-funds ladder so hardening turns see current phases.
    ["docs/REAL_FUNDS.md", "docs/REAL_FUNDS.md", true],
    // Always refresh fixtures — v2 owner-bound / three-spend samples.
    ["tests/spend-samples.json", "tests/spend-samples.json", true],
    [
      "tests/three-spend-claim.json",
      "tests/three-spend-claim.json",
      true,
    ],
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
      // Always force primary puzzles/ and the templates/secure-treasury/puzzles/
      // mirrors — Studio zip 8b6c5e70 kept a stale claim-msg (owed) mirror next
      // to a good puzzles/interest_payout.clsp (needsClspRefresh used to miss it).
      const force =
        /^puzzles\//i.test(toRel) ||
        /^templates\/secure-treasury\/puzzles\//i.test(toRel) ||
        (await needsClspRefresh(root, toRel));
      await writeFile(root, toRel, body, written, log, { force });
    } catch (err) {
      log(
        `[seed] skip ${fromRel}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return written;
}
