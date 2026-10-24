import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  checkVaultSecure,
  checkTreasurySecure,
  checkAnnouncementPairing,
  secureTreasuryFailures,
} from "./secure-checks.mjs";
import { verifyWorkspaceFiles } from "./verify.mjs";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "secure-treasury",
);

const vault = await fs.readFile(path.join(root, "puzzles/savings_vault.clsp"), "utf8");
const treasury = await fs.readFile(
  path.join(root, "puzzles/treasury_coin.clsp"),
  "utf8",
);
const payout = await fs.readFile(
  path.join(root, "puzzles/interest_payout.clsp"),
  "utf8",
);

assert.deepEqual(checkVaultSecure(vault), []);
assert.deepEqual(checkTreasurySecure(treasury), []);
assert.deepEqual(checkAnnouncementPairing(vault, treasury), []);

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

const missingPayout = secureTreasuryFailures([
  { path: "puzzles/savings_vault.clsp", content: vault },
  { path: "puzzles/treasury_coin.clsp", content: treasury },
]);
assert.ok(missingPayout.some((f) => /interest_payout/.test(f)));

const badOwner = checkVaultSecure(
  `(mod (MOD_HASH OWNER_PH mode)\n  (list (list 51 MOD_HASH 1))\n)`,
);
assert.ok(badOwner.some((f) => /OWNER_PH/.test(f)));

const badAmount = checkTreasurySecure(
  `(mod (MOD_HASH AUTHORIZER_PK mode amount interest_amount dest_ph)\n  (list (list 63 1) (list 51 MOD_HASH (- amount interest_amount)))\n)`,
);
assert.ok(badAmount.some((f) => /ASSERT_MY_AMOUNT/.test(f)));

console.log("secure-checks.test.mjs ok");
