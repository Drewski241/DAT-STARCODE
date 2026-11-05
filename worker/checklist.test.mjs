import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  checksFromPrompt,
  checklistFollowup,
  commandIsStaticServer,
  deriveProjectGoal,
  evaluateChecklist,
  firstOpenCheck,
  mergeChecks,
  promptWantsDevServer,
  withCheckResults,
} from "./checklist.mjs";

const war = checksFromPrompt(
  'Build me a card game. 2 player "War". That if anyone downloads the zip can play in a web browser.',
);
assert.ok(war.some((c) => c.kind === "play"));
assert.ok(war.some((c) => c.kind === "text" && c.text === "War"));
assert.ok(war.some((c) => c.kind === "page"));

const site = checksFromPrompt("Build a small website");
assert.equal(site.length, 1);
assert.equal(site[0].kind, "page");

const heading = checksFromPrompt("Change the heading to Hello");
assert.ok(heading.some((c) => c.kind === "text" && c.text === "Hello"));

const rust = checksFromPrompt("Write a small Rust CLI in main.rs");
assert.ok(rust.some((c) => c.kind === "cargo"));

const first = deriveProjectGoal("Build a dashboard with charts");
assert.match(String(first.summary), /dashboard/i);
assert.equal(first.status, "active");

const follow = deriveProjectGoal("Change the heading to Hello", {
  projectGoal: first,
});
assert.match(String(follow.summary), /dashboard/i);
assert.ok(follow.checks.some((c) => c.text === "Hello"));
assert.equal(
  mergeChecks(follow.checks, checksFromPrompt("Change the heading to Hello")).filter(
    (c) => c.text === "Hello",
  ).length,
  1,
);

const done = withCheckResults(follow, [
  { ...follow.checks[0], status: "passed" },
]);
assert.equal(done.status, follow.checks.length === 1 ? "done" : "active");

assert.equal(promptWantsDevServer("please npm run dev"), true);
assert.equal(promptWantsDevServer("Build a card game"), false);
assert.equal(commandIsStaticServer("npx http-server"), true);
assert.equal(commandIsStaticServer("cargo check"), false);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-check-"));
await fs.writeFile(
  path.join(root, "index.html"),
  "<!doctype html><h1>War Card Game</h1><button>Start Game</button>",
  "utf8",
);
const evaluated = await evaluateChecklist(
  root,
  [
    {
      id: "play-1",
      kind: "play",
      text: "Clicking Start shows a winner",
      file: "index.html",
      status: "open",
      detail: "",
    },
    {
      id: "text-war",
      kind: "text",
      text: "War",
      file: "index.html",
      status: "open",
      detail: "",
    },
    {
      id: "text-hello",
      kind: "text",
      text: "Hello",
      file: "index.html",
      status: "open",
      detail: "",
    },
  ],
  {
    play: async () => ({
      ok: true,
      reason: "Click changed the page and showed a card, score, or winner",
    }),
  },
);
assert.equal(evaluated.find((c) => c.kind === "play").status, "passed");
assert.equal(evaluated.find((c) => c.text === "War").status, "passed");
assert.equal(evaluated.find((c) => c.text === "Hello").status, "failed");
assert.match(firstOpenCheck(evaluated).text, /Hello/);
assert.match(checklistFollowup(firstOpenCheck(evaluated)), /index\.html/);
await fs.rm(root, { recursive: true, force: true });

console.log("checklist.test.mjs ok");
