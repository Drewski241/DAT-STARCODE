import assert from "node:assert/strict";
import {
  shouldRescueTreasuryPuzzles,
  goalAllowsTreasuryTemplateDiverge,
} from "./treasury-rescue.mjs";

assert.equal(
  goalAllowsTreasuryTemplateDiverge({
    playbooks: ["chialisp.md", "secure-treasury.md"],
  }),
  false,
);
assert.equal(
  goalAllowsTreasuryTemplateDiverge({
    playbooks: [
      "chialisp.md",
      "secure-treasury.md",
      "secure-treasury-real-funds.md",
    ],
  }),
  true,
);

const v2Diverge = shouldRescueTreasuryPuzzles({
  rescueFails: [],
  diverged: ["puzzles/interest_payout.clsp"],
  allowTemplateDiverge: false,
});
assert.equal(v2Diverge.rescue, true);
assert.match(v2Diverge.reason, /diverged/);

const realFundsDiverge = shouldRescueTreasuryPuzzles({
  rescueFails: [],
  diverged: ["puzzles/savings_vault.clsp", "puzzles/interest_payout.clsp"],
  allowTemplateDiverge: true,
});
assert.equal(realFundsDiverge.rescue, false);
assert.match(realFundsDiverge.reason, /intentional diverge|real-funds/i);

const realFundsBroken = shouldRescueTreasuryPuzzles({
  rescueFails: [
    "puzzles/interest_payout.clsp: claim-msg must take (owed owner)",
  ],
  diverged: ["puzzles/interest_payout.clsp"],
  allowTemplateDiverge: true,
});
assert.equal(realFundsBroken.rescue, true);
assert.match(realFundsBroken.reason, /secure-check/);

const clean = shouldRescueTreasuryPuzzles({
  rescueFails: [],
  diverged: [],
  allowTemplateDiverge: true,
});
assert.equal(clean.rescue, false);

console.log("treasury-rescue.test.mjs ok");
