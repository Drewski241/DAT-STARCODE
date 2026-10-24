import assert from "node:assert/strict";
import { defaultCurryArgsFor, extractPuzzleHash } from "./cdv.mjs";

const mod = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const vault = defaultCurryArgsFor("puzzles/savings_vault.clsp", mod);
assert.ok(vault);
assert.equal(vault[0], `0x${mod}`);
assert.equal(vault.length, 8);

const treasury = defaultCurryArgsFor("puzzles/treasury_coin.clsp", mod);
assert.ok(treasury);
assert.equal(treasury.length, 2);

const payout = defaultCurryArgsFor("puzzles/interest_payout.clsp", mod);
assert.ok(payout);
assert.equal(payout.length, 3);
assert.equal(
  payout[2],
  "0x4444444444444444444444444444444444444444444444444444444444444444",
);

assert.equal(defaultCurryArgsFor("puzzles/other.clsp", mod), null);
assert.equal(defaultCurryArgsFor("puzzles/savings_vault.clsp", "nope"), null);

assert.equal(
  extractPuzzleHash("Puzzle hash: 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);

console.log("cdv.test.mjs ok");
