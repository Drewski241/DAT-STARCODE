import assert from "node:assert/strict";
import {
  shouldEarlyExit,
  updateProgressState,
  isScreenshotThenDonePrompt,
  intentionalFailFilesReady,
} from "./progress-guard.mjs";

let state = { writes: 0, runs: 0, idleSteps: 0 };
for (let i = 0; i < 6; i++) {
  state = updateProgressState("list_files", "a\nb", state);
}
assert.equal(shouldEarlyExit(state).exit, true);

state = updateProgressState("write_file", "OK wrote src/a.ts (10 bytes)", {
  writes: 0,
  runs: 0,
  idleSteps: 5,
});
assert.equal(state.writes, 1);
assert.equal(state.idleSteps, 0);
assert.equal(shouldEarlyExit(state).exit, false);

state = updateProgressState(
  "str_replace",
  "OK str_replace src/a.ts (replaced 1 occurrence)",
  state,
);
assert.equal(state.writes, 2);
state = updateProgressState("start_server", '{"ok":true}', state);
assert.equal(state.runs, 1);

assert.equal(
  isScreenshotThenDonePrompt(
    "Use screenshot_url on the workspace index.html preview. Then done.",
  ),
  true,
);
assert.equal(
  isScreenshotThenDonePrompt(
    "Use screenshot_url then write_file PLAN.md. Then done.",
  ),
  false,
);

let shotState = { writes: 0, runs: 0, idleSteps: 0, screenshotOk: false };
shotState = updateProgressState(
  "screenshot_url",
  JSON.stringify({ ok: true, path: ".datstarcoder/preview.png" }),
  shotState,
);
assert.equal(shotState.screenshotOk, true);
const shotExit = shouldEarlyExit(shotState, { screenshotThenDone: true });
assert.equal(shotExit.exit, true);
assert.match(String(shotExit.doneMessage || ""), /Preview screenshot/);

assert.equal(
  intentionalFailFilesReady(
    'scripts.test is exactly: node -e "process.exit(1)". Do not change the test to pass.',
    ["package.json", "index.js"],
  ),
  true,
);
const failExit = shouldEarlyExit(
  { writes: 2, runs: 0, idleSteps: 0 },
  { intentionalFailReady: true },
);
assert.equal(failExit.exit, true);
assert.match(String(failExit.doneMessage || ""), /Left the test failing/);

console.log("progress-guard.test.mjs ok");
