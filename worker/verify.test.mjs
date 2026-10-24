import assert from "node:assert/strict";
import {
  findBarePuzzleHash,
  hasSiblingCreateCoins,
  verifyWorkspaceFiles,
  wantsChialisp,
} from "./verify.mjs";
import { inferGoal } from "./goals.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(wantsChialisp("write puzzles/mtt_pool.clsp"), true);
assert.equal(inferGoal("Finish the MTT pool and show the puzzle hash").id, "mtt_pool");
assert.equal(
  inferGoal("Hey this treasury puzzle was compromised — find the vuln and secure fix")
    .id,
  "secure_treasury",
);
assert.equal(
  inferGoal("secure the treasury savings vault in ChiaLisp").hard,
  true,
);
assert.equal(
  inferGoal(
    "Delete secure_treasury.clsp (leftover MTT stub). Keep puzzles/savings_vault.clsp.",
  ).id,
  "secure_treasury",
);
assert.equal(inferGoal("refactor the typescript API module").id, "coding");

assert.equal(
  findBarePuzzleHash(`## Puzzle hash\n\n\` 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef \`\n`),
  null,
);
assert.equal(
  findBarePuzzleHash(
    `## Puzzle hash\n\n\`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`\n`,
  ),
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);

const bad = verifyWorkspaceFiles([
  {
    path: "puzzles/mtt_pool.clsp",
    content: `(defun mtt () (let* ((x 1)) x))`,
  },
]);
assert.equal(bad.ok, false);

const dead = verifyWorkspaceFiles([
  {
    path: "puzzles/mtt_pool.clsp",
    content: `(mod (A)\n  (list (list 51 0xDEADBEEF 1))\n)`,
  },
]);
assert.equal(dead.ok, false);

const fakeOx = verifyWorkspaceFiles(
  [
    {
      path: "puzzles/mtt_pool.clsp",
      content: `(mod (POOL_PUZZLE_HASH)\n  (list (list 51 POOL_PUZZLE_HASH 1))\n)`,
    },
    {
      path: "docs/PUZZLE_HASH.md",
      content:
        "## Puzzle hash\n` 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef `\n",
    },
  ],
  { requireHash: true },
);
assert.equal(fakeOx.ok, false);

const withHash = verifyWorkspaceFiles(
  [
    {
      path: "puzzles/mtt_pool.clsp",
      content: `(mod (POOL_PUZZLE_HASH)\n  (list (list 51 POOL_PUZZLE_HASH 1))\n)`,
    },
    {
      path: "docs/PUZZLE_HASH.md",
      content:
        "## Puzzle hash\n\n`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`\n",
    },
  ],
  { requireHash: true },
);
assert.equal(withHash.ok, true);

const toolingMissing = verifyWorkspaceFiles(
  [
    {
      path: "puzzles/mtt_pool.clsp",
      content: `(mod (POOL_PUZZLE_HASH)\n  (list (list 51 POOL_PUZZLE_HASH 1))\n)`,
    },
    {
      path: "docs/PUZZLE_HASH.md",
      content:
        "## Puzzle hash\n\n`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`\n",
    },
  ],
  {
    requireHash: true,
    toolingOk: false,
    toolingMissing: ["cdv"],
    resultText: "cdv not found on this worker",
  },
);
assert.equal(toolingMissing.ok, false);
assert.ok(
  toolingMissing.failures.some((f) => /missing required ChiaLisp tooling/i.test(f)),
);

const badSiblings = `(mod (A)
  (list
    (list 50 A msg)
    (list 51 ph1 1)
    (list 51 ph2 2)
  )
)`;
assert.equal(hasSiblingCreateCoins(badSiblings), true);

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = readFileSync(
  path.join(here, "../templates/secure-treasury/puzzles/savings_vault.clsp"),
  "utf8",
);
const treasury = readFileSync(
  path.join(here, "../templates/secure-treasury/puzzles/treasury_coin.clsp"),
  "utf8",
);
const payout = readFileSync(
  path.join(here, "../templates/secure-treasury/puzzles/interest_payout.clsp"),
  "utf8",
);
assert.equal(hasSiblingCreateCoins(vault), false);
assert.equal(hasSiblingCreateCoins(treasury), false);
assert.equal(hasSiblingCreateCoins(payout), false);

const strictOk = verifyWorkspaceFiles(
  [
    { path: "puzzles/savings_vault.clsp", content: vault },
    { path: "puzzles/treasury_coin.clsp", content: treasury },
    { path: "puzzles/interest_payout.clsp", content: payout },
    {
      path: "docs/PUZZLE_HASH.md",
      content:
        "## Puzzle hash\n\n`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`\n",
    },
  ],
  { requireHash: true, strictSingleton: true, secureTreasury: true },
);
assert.equal(strictOk.ok, true, JSON.stringify(strictOk.failures));

const strictBad = verifyWorkspaceFiles(
  [{ path: "puzzles/bad.clsp", content: badSiblings }],
  { strictSingleton: true },
);
assert.equal(strictBad.ok, false);

console.log("verify.test.mjs ok");
