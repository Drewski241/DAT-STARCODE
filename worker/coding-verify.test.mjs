import assert from "node:assert/strict";
import {
  pickVerifyCommands,
  testCommandForScript,
  codingWorkspaceWorthVerify,
  verifyObservationOk,
} from "./coding-verify.mjs";

assert.deepEqual(
  pickVerifyCommands({
    scripts: { test: "vitest", build: "next build", lint: "eslint ." },
  }),
  ["npm test -- --watchAll=false", "npm run build"],
);

assert.equal(
  testCommandForScript('node -e "process.exit(1)"'),
  "npm test",
);
assert.deepEqual(
  pickVerifyCommands({
    scripts: { test: 'node -e "process.exit(1)"', dev: "http-server" },
  }),
  ["npm test"],
);

assert.deepEqual(pickVerifyCommands({ scripts: { lint: "eslint ." } }), [
  "npm run lint",
]);

assert.equal(
  codingWorkspaceWorthVerify([{ path: "package.json" }, { path: "index.html" }]),
  true,
);
assert.equal(
  codingWorkspaceWorthVerify([{ path: "puzzles/vault.clsp" }]),
  false,
);

assert.equal(verifyObservationOk("exit 0\nok"), true);
assert.equal(verifyObservationOk("exit 1\nfail"), false);
assert.equal(verifyObservationOk("ERROR: nope"), false);

console.log("coding-verify.test.mjs ok");
