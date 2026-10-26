import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  loadCheckpoint,
  saveCheckpoint,
  formatCheckpointForPrompt,
  mergeLongHorizon,
  memoryAnswerScaffold,
  CHECKPOINT_REL,
} from "./project-memory.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "dat-cp-"));
assert.equal(await loadCheckpoint(root), null);

await saveCheckpoint(root, {
  lastCommand: "npm run build",
  lastErrorKind: "typescript",
  lastErrorSnippet: "TS2322 at src/x.ts",
  filesTouched: ["src/x.ts"],
});
const cp = await loadCheckpoint(root);
assert.equal(cp.lastCommand, "npm run build");
assert.ok(
  (await fs.readFile(path.join(root, CHECKPOINT_REL), "utf8")).includes(
    "typescript",
  ),
);
const formatted = formatCheckpointForPrompt(cp);
assert.match(formatted, /Project checkpoint/);
assert.match(formatted, /npm run build/);

const merged = mergeLongHorizon(
  { decisions: ["a"], neverDo: ["xdg-open"], openBugs: ["bug1"] },
  { decisions: ["b"], openBugs: ["bug2"], verifyFailStreak: 2 },
);
assert.ok(merged.decisions.includes("a") && merged.decisions.includes("b"));
assert.ok(merged.neverDo.includes("xdg-open"));
assert.equal(merged.verifyFailStreak, 2);
assert.match(
  formatCheckpointForPrompt(merged),
  /VERIFY_FAIL_STREAK/,
);

const scaffold = memoryAnswerScaffold({
  neverDo: ["xdg-open"],
  openBugs: ["Verify failed: npm test"],
  filesTouched: ["package.json", "index.js"],
  lastCommand: "npm test",
  verifyStatus: "failed",
  decisions: ["leave test failing"],
});
assert.match(scaffold, /neverDo:.*xdg-open/);
assert.match(scaffold, /filesTouched:.*package\.json/);
assert.match(scaffold, /verifyStatus: failed/);

await fs.rm(root, { recursive: true, force: true });
console.log("project-memory.test.mjs ok");
