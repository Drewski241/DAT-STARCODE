import assert from "node:assert/strict";
import { chatWatchLimits, parseGpuSample, watchDecision } from "./ollama-watch.mjs";

assert.equal(chatWatchLimits("qwen2.5-coder:7b").stallMs, 90_000);
assert.equal(chatWatchLimits("qwen2.5-coder:32b").deadlineMs, 8 * 60_000);

assert.equal(parseGpuSample("7, 32.40").idle, true);
assert.equal(parseGpuSample("85, 344").idle, false);
assert.equal(parseGpuSample("0, [N/A]").idle, false);
assert.equal(parseGpuSample("nope"), null);

const limits = { stallMs: 90_000, deadlineMs: 120_000, heartbeatMs: 30_000 };
assert.equal(
  watchDecision(0, 0, 0, 30_000, limits).heartbeat,
  true,
);
assert.equal(watchDecision(0, 0, 0, 30_000, limits).gpuCheck, false);
assert.equal(watchDecision(0, 0, 0, 50_000, limits).gpuCheck, true);
assert.match(
  watchDecision(0, 0, 0, 90_000, limits).abort || "",
  /stalled/,
);
assert.match(
  watchDecision(0, 80_000, 0, 120_000, limits).abort || "",
  /exceeded/,
);

console.log("ollama-watch.test.mjs ok");
