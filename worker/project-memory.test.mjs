import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  loadCheckpoint,
  saveCheckpoint,
  formatCheckpointForPrompt,
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

await fs.rm(root, { recursive: true, force: true });
console.log("project-memory.test.mjs ok");
