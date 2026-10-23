import assert from "node:assert/strict";
import { verifyWorkspaceFiles, wantsChialisp } from "./verify.mjs";
import { inferGoal } from "./goals.mjs";

assert.equal(wantsChialisp("write puzzles/mtt_pool.clsp"), true);
assert.equal(inferGoal("Finish the MTT pool and show the puzzle hash").id, "mtt_pool");
assert.equal(inferGoal("refactor the typescript API module").id, "coding");

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
assert.ok(dead.failures.some((f) => /DEADBEEF/.test(f)));

const needHash = verifyWorkspaceFiles(
  [
    {
      path: "puzzles/mtt_pool.clsp",
      content: `(mod (POOL_PUZZLE_HASH)\n  (list (list 51 POOL_PUZZLE_HASH 1))\n)`,
    },
    {
      path: "docs/MTT_POOL.md",
      content:
        "# hi\nAUTHORIZER_PK: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef\n",
    },
  ],
  { requireHash: true, resultText: "done" },
);
assert.equal(needHash.ok, false);

const withHash = verifyWorkspaceFiles(
  [
    {
      path: "puzzles/mtt_pool.clsp",
      content: `(mod (POOL_PUZZLE_HASH)\n  (list (list 51 POOL_PUZZLE_HASH 1))\n)`,
    },
    {
      path: "docs/MTT_POOL.md",
      content:
        "## Pool puzzle hash\n\n`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`\n",
    },
  ],
  { requireHash: true },
);
assert.equal(withHash.ok, true);

console.log("verify.test.mjs ok");
