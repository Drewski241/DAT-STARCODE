import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  checkVaultSecure,
  checkTreasurySecure,
  checkPayoutSecure,
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
assert.deepEqual(checkPayoutSecure(payout), []);
assert.deepEqual(checkAnnouncementPairing(vault, treasury, payout), []);

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

const staleClaim = checkVaultSecure(`(mod (MOD_HASH AUTHORIZER_PK MIN_HOLD_SECONDS INTEREST_BPS TREASURY_PH PRINCIPAL DEPOSIT_SECONDS OWNER_PH mode now_seconds)
  (defun vault-ph (mod_hash auth min_hold bps treasury_ph principal deposit_seconds owner_ph)
    (sha256tree (c mod_hash (list auth min_hold bps treasury_ph principal deposit_seconds owner_ph)))
  )
  (defun mode-claim-only (elapsed owed)
    (list
      (list 51
        (vault-ph MOD_HASH AUTHORIZER_PK MIN_HOLD_SECONDS INTEREST_BPS TREASURY_PH
          PRINCIPAL DEPOSIT_SECONDS OWNER_PH)
        PRINCIPAL
      )
      (list 61 1)
    )
  )
  (if (= mode 4) (mode-claim-only 1 1) (x))
)`);
assert.ok(staleClaim.some((f) => /now_seconds|stale clock|deposit/i.test(f)));

const badPayout = checkPayoutSecure(
  `(mod (AUTHORIZER_PK TREASURY_PH dest_ph interest_amount)
  (list (list 61 1) (list 51 dest_ph interest_amount))
)`,
);
assert.ok(badPayout.some((f) => /OWNER_PH|dest_ph/i.test(f)));

console.log("secure-checks.test.mjs ok");
