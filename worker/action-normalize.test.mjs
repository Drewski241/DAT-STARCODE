import assert from "node:assert/strict";
import {
  normalizeToolName,
  normalizeAgentAction,
  recoverActionFromText,
  toolRepairMessage,
  isCheckpointQuestion,
} from "./action-normalize.mjs";

assert.equal(normalizeToolName("write_file"), "write_file");
assert.equal(normalizeToolName("writeFile"), "write_file");
assert.equal(normalizeToolName("undefined"), null);
assert.equal(normalizeToolName(""), null);
assert.equal(normalizeToolName("grep"), "search_files");
assert.equal(normalizeToolName("screenshot"), "screenshot_url");

{
  const bad = normalizeAgentAction({ args: { path: "a.ts" } }, "");
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "missing_tool");
}

{
  const fixed = normalizeAgentAction(
    { tool: "undefined", args: {} },
    'Please call write_file path=index.js content=\nconsole.log("ok");',
  );
  assert.equal(fixed.ok, true);
  assert.equal(fixed.action.tool, "write_file");
  assert.equal(fixed.repaired, true);
}

{
  const shot = normalizeAgentAction(
    null,
    "Use screenshot_url on http://127.0.0.1:3000/",
  );
  assert.equal(shot.ok, true);
  assert.equal(shot.action.tool, "screenshot_url");
}

{
  const done = normalizeAgentAction({ done: true, message: "hi" });
  assert.equal(done.ok, true);
  assert.equal(done.action.done, true);
}

assert.match(toolRepairMessage({ reason: "missing_tool" }), /Allowed tools/);
assert.equal(
  isCheckpointQuestion(
    "What did we learn last turn? Summarize open bugs from the checkpoint.",
  ),
  true,
);
assert.equal(isCheckpointQuestion("Add a button"), false);

const recovered = recoverActionFromText(
  'Find where "Hello Continuity" is defined',
);
assert.equal(recovered?.tool, "search_files");

console.log("action-normalize.test.mjs ok");
