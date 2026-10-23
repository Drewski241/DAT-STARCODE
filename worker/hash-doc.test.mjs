import assert from "node:assert/strict";
import {
  pickClspForHash,
  upsertPoolPuzzleHashSection,
} from "./hash-doc.mjs";
import { findBarePuzzleHash } from "./verify.mjs";
import { extractPuzzleHash } from "./cdv.mjs";

const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

assert.equal(
  pickClspForHash(["docs/MTT_POOL.md", "puzzles/mtt_pool.clsp", "foo.clsp"]),
  "puzzles/mtt_pool.clsp",
);
assert.equal(pickClspForHash(["other/x.clsp"]), "other/x.clsp");

const replaced = upsertPoolPuzzleHashSection(
  `# MTT\n\n## Pool puzzle hash\n\n\` 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef \`\n\n## Curry order\n1. BUY_IN\n`,
  hash,
);
assert.equal(findBarePuzzleHash(replaced), hash);
assert.ok(!/0x1234/i.test(replaced.split("## Curry")[0]));

const appended = upsertPoolPuzzleHashSection("# MTT pool\n", hash);
assert.equal(findBarePuzzleHash(appended), hash);

assert.equal(
  extractPuzzleHash("Puzzle hash: 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);

console.log("hash-doc.test.mjs ok");
