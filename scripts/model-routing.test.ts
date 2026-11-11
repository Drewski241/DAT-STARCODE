import assert from "node:assert/strict";
import { resolveModel } from "../src/lib/models";

const hard = resolveModel("auto", "Write puzzles/mtt_pool.clsp for ChiaLisp");
assert.equal(hard.resolved, "qwen2.5-coder:32b");
assert.match(hard.reason, /32b/);

const complex = resolveModel(
  "auto",
  "Refactor the Next.js auth flow across multiple files",
);
assert.equal(complex.resolved, "grok-4.7");
assert.match(complex.reason, /multi-file change/);

const stack = resolveModel(
  "auto",
  "TypeError: Cannot read properties of undefined\n    at completeJob (/src/lib/store.ts:40:12)",
);
assert.equal(stack.resolved, "grok-4.7");

const explicitGrok = resolveModel("grok", "Rename the button label to Ship.");
assert.equal(explicitGrok.resolved, "grok-4.7");
assert.equal(explicitGrok.reason, "User selected Grok");

const keepLocal = resolveModel(
  "auto",
  "Keep it local. Fix this bug. Traceback (most recent call last):\nZeroDivisionError",
);
assert.equal(keepLocal.resolved, "qwen2.5-coder:32b");
assert.doesNotMatch(keepLocal.reason, /Grok/);

const light = resolveModel("auto", "Fix the login button label in the component");
assert.equal(light.resolved, "qwen2.5-coder:7b");

const general = resolveModel("auto", "What is the capital of France?");
assert.equal(general.resolved, "llama3.1:8b");

const rust = resolveModel("auto", "Write a small Rust CLI in main.rs");
assert.equal(rust.resolved, "qwen2.5-coder:32b");

const rue = resolveModel("auto", "Write a Rue program in hello.rue");
assert.equal(rue.resolved, "qwen2.5-coder:32b");

const trust = resolveModel("auto", "I trust this code");
assert.equal(trust.resolved, "qwen2.5-coder:7b");

const explicit = resolveModel("qwen2.5-coder:14b", "Write a ChiaLisp puzzle");
assert.equal(explicit.resolved, "qwen2.5-coder:14b");

const war = resolveModel(
  "auto",
  'Build me a card game. 2 player "War". That if anyone downloads the zip can play in a web browser.',
);
assert.equal(war.resolved, "qwen2.5-coder:32b");
assert.match(war.reason, /Playable game/);

const still = resolveModel(
  "auto",
  "Hey It seems the start game still doesn't do anything when i click it in the preview html. I would like to play a complete game of war.",
  {
    preferCoding: true,
    priorPrompt: 'Build me a card game. 2 player "War".',
  },
);
assert.equal(still.resolved, "qwen2.5-coder:32b");

const retry = resolveModel("auto", "try again", {
  preferCoding: true,
  priorPrompt: 'Build me a card game. 2 player "War".',
});
assert.equal(retry.resolved, "qwen2.5-coder:32b");

const site = resolveModel("auto", "Build a small website");
assert.equal(site.resolved, "qwen2.5-coder:7b");

const headingAfterWin = resolveModel("auto", "Change the heading to Hello", {
  preferCoding: true,
  priorPrompt: 'Build me a card game. 2 player "War".',
  priorResult: "Played index.html. Click changed the page and showed a winner.",
});
assert.equal(headingAfterWin.resolved, "qwen2.5-coder:7b");

const headingAfterLimit = resolveModel("auto", "Change the heading to Hello", {
  preferCoding: true,
  priorPrompt: "Build a small website",
  priorResult: "# Reached step limit\n\nThe agent stopped before the page was done.",
});
assert.equal(headingAfterLimit.resolved, "qwen2.5-coder:32b");
assert.match(headingAfterLimit.reason, /previous turn failed/);

const afterChecklist = resolveModel("auto", "Change the heading to Hello", {
  preferCoding: true,
  priorPrompt: "Build a small website",
  priorResult: "## Checklist failed\n\n“Hello” is not in the project files",
});
assert.equal(afterChecklist.resolved, "qwen2.5-coder:32b");

console.log("model-routing.test.ts ok");
