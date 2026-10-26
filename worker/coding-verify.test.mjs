import assert from "node:assert/strict";
import {
  pickVerifyCommands,
  testCommandForScript,
  codingWorkspaceWorthVerify,
  verifyObservationOk,
  isIntentionalVerifyFail,
  enforceIntentionalFailScripts,
  ensureIntentionalFailDeliverables,
  INTENTIONAL_FAIL_TEST_SCRIPT,
} from "./coding-verify.mjs";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

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
  isIntentionalVerifyFail(
    'Overwrite package.json so scripts.test is exactly: node -e "process.exit(1)"\nDo not change the test to pass.',
  ),
  true,
);
assert.equal(isIntentionalVerifyFail("Fix the failing unit tests"), false);

{
  // Live zip f4fc292f: model put exit(1) on scripts.dev
  const fixed = enforceIntentionalFailScripts({
    name: "my-project",
    scripts: { dev: 'node -e "process.exit(1)"' },
  });
  assert.equal(fixed.changed, true);
  assert.equal(fixed.pkg.scripts.test, INTENTIONAL_FAIL_TEST_SCRIPT);
  assert.equal(fixed.pkg.scripts.dev, "http-server");
  assert.deepEqual(
    pickVerifyCommands(fixed.pkg),
    ["npm test"],
  );
}

{
  // Live zip 3b520e35: neither package.json nor index.js survived the turn
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-intent-"));
  const out = await ensureIntentionalFailDeliverables(root);
  assert.equal(out.changed, true);
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.test, INTENTIONAL_FAIL_TEST_SCRIPT);
  assert.match(await fs.readFile(path.join(root, "index.js"), "utf8"), /console\.log\("ok"\)/);
  assert.deepEqual(pickVerifyCommands(pkg), ["npm test"]);
  await fs.rm(root, { recursive: true, force: true });
}

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
