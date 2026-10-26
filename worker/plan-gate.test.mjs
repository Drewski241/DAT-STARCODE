import assert from "node:assert/strict";
import {
  planLooksComplete,
  shouldBlockEditWithoutPlan,
  shouldRejectDoneWithoutPlan,
  planGateMessage,
} from "./plan-gate.mjs";

assert.equal(
  planLooksComplete("# Plan\n## Goal\nx\n## Done when\ny\n## Files\n- a.ts\n"),
  true,
);
assert.equal(planLooksComplete("todo"), false);

assert.equal(
  shouldBlockEditWithoutPlan({
    hard: true,
    wantCdv: false,
    goalId: "coding",
    planPresent: false,
    planComplete: false,
    tool: "write_file",
    path: "src/a.ts",
  }),
  true,
);
assert.equal(
  shouldBlockEditWithoutPlan({
    hard: true,
    wantCdv: false,
    goalId: "coding",
    planPresent: false,
    planComplete: false,
    tool: "write_file",
    path: "PLAN.md",
  }),
  false,
);

assert.equal(
  shouldRejectDoneWithoutPlan({
    hard: true,
    goalId: "coding",
    planPresent: false,
    planComplete: false,
  }),
  true,
);
assert.match(planGateMessage({ planPresent: false, planComplete: false }), /PLAN\.md/);

console.log("plan-gate.test.mjs ok");
