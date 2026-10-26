import assert from "node:assert/strict";
import {
  deriveProjectGoal,
  formatProjectGoalForPrompt,
  rankContinueFiles,
} from "./project-goals.mjs";

const g = deriveProjectGoal("Build a dashboard with charts");
assert.match(String(g.summary), /dashboard/i);
assert.equal(g.status, "active");

const md = formatProjectGoalForPrompt({ projectGoal: g });
assert.match(md, /Project goal/);

const ranked = rankContinueFiles(
  ["README.md", "src/a.ts", "package.json", "RESULT.md"],
  ["src/a.ts"],
);
assert.equal(ranked[0], "src/a.ts");
assert.ok(ranked.indexOf("package.json") < ranked.indexOf("RESULT.md"));

const soft = rankContinueFiles(
  ["puzzles/vault.clsp", "index.html", "package.json"],
  [],
  { softCoding: true },
);
assert.equal(soft[soft.length - 1], "puzzles/vault.clsp");
assert.ok(soft.indexOf("package.json") < soft.indexOf("puzzles/vault.clsp"));

console.log("project-goals.test.mjs ok");