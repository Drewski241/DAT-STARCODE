import assert from "node:assert/strict";
import {
  pickClspForHash,
  upsertPuzzleHashSection,
  PUZZLE_HASH_DOC,
} from "./hash-doc.mjs";
import { findBarePuzzleHash } from "./verify.mjs";
import { extractPuzzleHash } from "./cdv.mjs";

const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

assert.equal(PUZZLE_HASH_DOC, "docs/PUZZLE_HASH.md");

assert.equal(
  pickClspForHash(["docs/PUZZLE_HASH.md", "puzzles/mtt_pool.clsp", "foo.clsp"]),
  "puzzles/mtt_pool.clsp",
);
assert.equal(
  pickClspForHash(["puzzles/savings_vault.clsp", "puzzles/mtt_pool.clsp"]),
  "puzzles/savings_vault.clsp",
);
assert.equal(pickClspForHash(["other/x.clsp"]), "other/x.clsp");

const replaced = upsertPuzzleHashSection(
  `# Notes\n\n## Pool puzzle hash\n\n\` 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef \`\n\n## Curry order\n1. BUY_IN\n`,
  hash,
);
assert.equal(findBarePuzzleHash(replaced), hash);
assert.ok(/## Puzzle hash/.test(replaced));
assert.ok(!/0x1234/i.test(replaced.split("## Curry")[0]));

const appended = upsertPuzzleHashSection("# Puzzle hash\n", hash);
assert.equal(findBarePuzzleHash(appended), hash);

assert.equal(
  findBarePuzzleHash(`## Puzzle hash\n\n\`${hash}\`\n`),
  hash,
);

assert.equal(
  extractPuzzleHash(
    "Puzzle hash: 0x34c4755463240b02f3b3ec4214119e591b9cef300f1ed6a45b9a81789cae57ac",
  ),
  "34c4755463240b02f3b3ec4214119e591b9cef300f1ed6a45b9a81789cae57ac",
);
assert.equal(
  extractPuzzleHash("Puzzle hash: 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
  null,
);

console.log("hash-doc.test.mjs ok");
