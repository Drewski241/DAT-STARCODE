import assert from "node:assert/strict";
import { summarizeWorkspaceDiff, formatDiffForPrompt } from "./diff-summary.mjs";

const diff = summarizeWorkspaceDiff(
  [
    { path: "a.ts", content: "const x = 1;\n" },
    { path: "gone.ts", content: "bye\n" },
  ],
  [
    { path: "a.ts", content: "const x = 2;\n" },
    { path: "b.ts", content: "new\n" },
  ],
);
assert.deepEqual(diff.added, ["b.ts"]);
assert.deepEqual(diff.removed, ["gone.ts"]);
assert.deepEqual(diff.changed, ["a.ts"]);
assert.match(formatDiffForPrompt(diff), /Workspace diff/);
assert.match(diff.snippets[0].patch, /- const x = 1/);

console.log("diff-summary.test.mjs ok");
