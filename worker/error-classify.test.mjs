import assert from "node:assert/strict";
import {
  classifyErrorLog,
  promptLooksLikeErrorDump,
  formatClassificationNudge,
  observationLooksLikeFailedRun,
} from "./error-classify.mjs";

assert.equal(
  classifyErrorLog("Error: Cannot find module 'zod'\nRequire stack:\n- src/app.ts")
    .kind,
  "deps_missing",
);
assert.equal(
  classifyErrorLog("src/page.tsx(12,5): error TS2322: Type 'string' is not assignable")
    .kind,
  "typescript",
);
assert.equal(
  classifyErrorLog("Failed to compile.\n./app/page.tsx\nModule not found: Can't resolve './missing'")
    .kind,
  "next_build",
);
assert.ok(
  promptLooksLikeErrorDump(
    "Help fix this:\n\nError: Cannot find module 'foo'\nRequire stack:\n- a.js\nexit 1",
  ),
);
assert.equal(promptLooksLikeErrorDump("make a cool website"), false);

const nudge = formatClassificationNudge(
  classifyErrorLog("MODULE_NOT_FOUND: Cannot find package 'left-pad'"),
);
assert.match(nudge, /ERROR_CLASS/);
assert.match(nudge, /npm install|deps/i);

console.log("error-classify.test.mjs ok");


const gtkOk = `exit 0\n\nSTDERR:\nGtk-Message: 13:40:45.888: Not loading module "atk-bridge": The functionality is provided by GTK natively. Please try to not load it.\n`;
assert.equal(observationLooksLikeFailedRun(gtkOk), false);
assert.equal(
  classifyErrorLog(gtkOk).kind === "command_failed",
  false,
  "Gtk stderr + exit 0 must not be command_failed",
);
assert.equal(observationLooksLikeFailedRun("exit 1\nSTDERR:\nbang"), true);
assert.equal(observationLooksLikeFailedRun("ERROR: blocked"), true);
assert.equal(observationLooksLikeFailedRun("exit 0\nok"), false);
