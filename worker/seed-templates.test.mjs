import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { seedTemplatesForGoal } from "./seed-templates.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldPayout = await fs.readFile(
  path.join(here, "..", "templates", "secure-treasury", "puzzles", "interest_payout.clsp"),
  "utf8",
);

assert.ok(
  /\(defun\s+claim-msg\s*\(\s*owed\s+owner\s*\)/i.test(goldPayout),
  "repo gold interest_payout must use claim-msg (owed owner)",
);

const stalePayout = `; stale Studio mirror (zip 8b6c5e70)
(mod (AUTHORIZER_PK TREASURY_PH OWNER_PH interest_amount)
  (defun sha256tree (TREE)
    (if (l TREE)
      (sha256 2 (sha256tree (f TREE)) (sha256tree (r TREE)))
      (sha256 1 TREE)
    )
  )
  (defun claim-msg (owed)
    (sha256tree (list 1 owed OWNER_PH))
  )
  (list
    (list 61 (sha256 TREASURY_PH (claim-msg interest_amount)))
    (list 51 OWNER_PH interest_amount)
  )
)
`;

const root = await fs.mkdtemp(path.join(os.tmpdir(), "dat-seed-"));
const mirrorRel = "templates/secure-treasury/puzzles/interest_payout.clsp";
const liveRel = "puzzles/interest_payout.clsp";

await fs.mkdir(path.join(root, path.dirname(mirrorRel)), { recursive: true });
await fs.mkdir(path.join(root, "puzzles"), { recursive: true });
await fs.writeFile(path.join(root, mirrorRel), stalePayout, "utf8");
await fs.writeFile(path.join(root, liveRel), stalePayout, "utf8");

const written = await seedTemplatesForGoal(root, "secure_treasury", {
  log: () => {},
});

assert.ok(
  written.includes(mirrorRel),
  `expected force-refresh of ${mirrorRel}, wrote: ${written.join(", ")}`,
);
assert.ok(
  written.includes(liveRel),
  `expected force-refresh of ${liveRel}, wrote: ${written.join(", ")}`,
);

const mirror = await fs.readFile(path.join(root, mirrorRel), "utf8");
const live = await fs.readFile(path.join(root, liveRel), "utf8");
assert.equal(mirror, goldPayout);
assert.equal(live, goldPayout);
assert.ok(!/\(defun\s+claim-msg\s*\(\s*owed\s*\)/i.test(mirror));

const realFundsRel = "docs/REAL_FUNDS.md";
assert.ok(
  written.includes(realFundsRel),
  `expected force-seed of ${realFundsRel}, wrote: ${written.join(", ")}`,
);
const realFunds = await fs.readFile(path.join(root, realFundsRel), "utf8");
assert.ok(/OWNER_PK/i.test(realFunds) && /Phase B/i.test(realFunds));

await fs.rm(root, { recursive: true, force: true });
console.log("seed-templates.test.mjs ok");
