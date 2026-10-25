import assert from "node:assert/strict";
import {
  shouldEarlyExit,
  updateProgressState,
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

console.log("progress-guard.test.mjs ok");
