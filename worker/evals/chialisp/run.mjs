#!/usr/bin/env node
/**
 * Offline ChiaLisp verification evals (no Ollama required).
 * Run: node worker/evals/chialisp/run.mjs
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  verifyWorkspaceFiles,
  findBarePuzzleHash,
  hasSiblingCreateCoins,
} from "../../verify.mjs";
import { inferGoal } from "../../goals.mjs";
import {
  secureTreasuryFailures,
  checkVaultSecure,
  checkTreasurySecure,
  checkAnnouncementPairing,
} from "../../secure-checks.mjs";
import { promises as fsRoot } from "fs";
import pathRoot from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

async function read(name) {
  return fs.readFile(path.join(fixtures, name), "utf8");
}

const cases = [
  {
    id: "golden-minimal",
    expectOk: true,
    files: async () => [
      {
        path: "puzzles/golden.clsp",
        content: await read("golden-minimal.clsp"),
      },
      {
        path: "docs/PUZZLE_HASH.md",
        content: await read("golden-pool-hash.md"),
      },
    ],
    opts: { requireHash: true },
  },
  {
    id: "trap-common-lisp",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/bad.clsp",
        content: await read("trap-common-lisp.clsp"),
      },
    ],
  },
  {
    id: "trap-agg-sig-as-if",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/bad.clsp",
        content: await read("trap-agg-sig-as-if.clsp"),
      },
    ],
  },
  {
    id: "trap-deadbeef",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/bad.clsp",
        content: await read("trap-deadbeef.clsp"),
      },
    ],
  },
  {
    id: "trap-index-syntax",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/bad.clsp",
        content: await read("trap-index-syntax.clsp"),
      },
    ],
  },
  {
    id: "trap-fake-ox-hash",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/ok.clsp",
        content: await read("golden-minimal.clsp"),
      },
      {
        path: "docs/PUZZLE_HASH.md",
        content: await read("trap-fake-ox-hash.md"),
      },
    ],
    opts: { requireHash: true },
  },
  {
    id: "tooling-required",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/ok.clsp",
        content: await read("golden-minimal.clsp"),
      },
      {
        path: "docs/PUZZLE_HASH.md",
        content: await read("golden-pool-hash.md"),
      },
    ],
    opts: {
      requireHash: true,
      toolingOk: false,
      toolingMissing: ["cdv", "clvm_tools"],
    },
  },
];

let failed = 0;
for (const c of cases) {
  const files = await c.files();
  const result = verifyWorkspaceFiles(files, c.opts || {});
  try {
    assert.equal(
      result.ok,
      c.expectOk,
      `${c.id}: expected ok=${c.expectOk}, got ok=${result.ok} failures=${JSON.stringify(result.failures)}`,
    );
    console.log(`ok  ${c.id}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.id}: ${err instanceof Error ? err.message : err}`);
  }
}

const ox = findBarePuzzleHash(await read("trap-fake-ox-hash.md"));
assert.equal(ox, null, "0x-prefixed hash must not count as bare");
const bare = findBarePuzzleHash(await read("golden-pool-hash.md"));
assert.equal(
  bare,
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
console.log("ok  bare-hash-helpers");

try {
  const g = inferGoal(
    "Hey this treasury puzzle was compromised. Find the vulnerability and secure fix in ChiaLisp.",
  );
  assert.equal(g.id, "secure_treasury");
  assert.equal(g.hard, true);
  assert.ok(g.playbooks.includes("secure-treasury.md"));
  console.log("ok  treasury-routing");
} catch (err) {
  failed += 1;
  console.error(
    `FAIL treasury-routing: ${err instanceof Error ? err.message : err}`,
  );
}

try {
  const tpl = pathRoot.join(here, "../../../templates/secure-treasury/puzzles");
  const vault = await fsRoot.readFile(pathRoot.join(tpl, "savings_vault.clsp"), "utf8");
  const treasury = await fsRoot.readFile(
    pathRoot.join(tpl, "treasury_coin.clsp"),
    "utf8",
  );
  const payout = await fsRoot.readFile(
    pathRoot.join(tpl, "interest_payout.clsp"),
    "utf8",
  );
  const missing = secureTreasuryFailures([
    { path: "puzzles/savings_vault.clsp", content: vault },
    { path: "puzzles/treasury_coin.clsp", content: treasury },
  ]);
  assert.ok(
    missing.some((f) => /interest_payout/.test(f)),
    "expected missing interest_payout failure",
  );
  console.log("ok  trap-missing-payout");

  const sibling = `(mod (A)
  (list
    (list 50 A msg)
    (list 51 ph1 1)
    (list 51 ph2 2)
  )
)`;
  assert.equal(hasSiblingCreateCoins(sibling), true);
  const siblingVerify = verifyWorkspaceFiles(
    [{ path: "puzzles/bad.clsp", content: sibling }],
    { strictSingleton: true },
  );
  assert.equal(siblingVerify.ok, false);
  console.log("ok  trap-sibling-create");

  const unboundOwner = checkVaultSecure(
    `(mod (MOD_HASH OWNER_PH mode)\n  (list (list 51 MOD_HASH 1))\n)`,
  );
  assert.ok(unboundOwner.some((f) => /OWNER_PH/.test(f)));
  console.log("ok  trap-unbound-owner");

  const noMyAmount = checkTreasurySecure(
    `(mod (MOD_HASH AUTHORIZER_PK mode amount interest_amount dest_ph)\n  (list (list 63 1) (list 51 MOD_HASH (- amount 1)))\n)`,
  );
  assert.ok(noMyAmount.some((f) => /ASSERT_MY_AMOUNT/.test(f)));
  console.log("ok  trap-missing-assert-my-amount");

  const pairFail = checkAnnouncementPairing(
    `(mod ()\n  (list (list 61 (sha256 TREASURY_PH msg)) (list 51 OWNER_PH 1))\n)`,
    `(mod (A)\n  (list (list 62 claim) (list 51 A 1))\n)`,
  );
  assert.ok(pairFail.some((f) => /Announcement pairing/i.test(f)));
  console.log("ok  trap-announcement-mismatch");

  const golden = verifyWorkspaceFiles(
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
    { requireHash: true, secureTreasury: true, strictSingleton: true },
  );
  assert.equal(golden.ok, true, JSON.stringify(golden.failures));
  console.log("ok  golden-secure-treasury-templates");
} catch (err) {
  failed += 1;
  console.error(
    `FAIL secure-treasury-traps: ${err instanceof Error ? err.message : err}`,
  );
}

if (failed) {
  console.error(`\n${failed} eval case(s) failed`);
  process.exit(1);
}
console.log(`\nchialisp evals: ${cases.length + 8} passed`);
