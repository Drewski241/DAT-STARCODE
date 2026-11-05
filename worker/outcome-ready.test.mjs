import assert from "node:assert/strict";
import { outcomeReadyFromTool } from "./outcome-ready.mjs";

assert.equal(
  outcomeReadyFromTool("run", { command: "cargo check" }, "exit 0\nFinished").ready,
  true,
);
assert.equal(
  outcomeReadyFromTool("run", { command: "cargo check" }, "exit 101\nerror").ready,
  false,
);
assert.equal(
  outcomeReadyFromTool("run", { command: "npm test" }, "exit 0").ready,
  false,
);
assert.equal(
  outcomeReadyFromTool(
    "puzzle_hash",
    {},
    "puzzle hash: abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd",
  ).ready,
  true,
);
assert.equal(
  outcomeReadyFromTool("puzzle_hash", {}, "puzzle hash: placeholder").ready,
  false,
);

console.log("outcome-ready.test.mjs ok");
