import { verifyWorkspaceFiles, wantsChialisp } from "./verify.mjs";
import assert from "node:assert/strict";

assert.equal(wantsChialisp("write puzzles/mtt_pool.clsp"), true);
assert.equal(wantsChialisp("fix a typo in README"), false);

const bad = verifyWorkspaceFiles([
  {
    path: "puzzles/mtt_pool.clsp",
    content: `(defun mtt () (let* ((x 1)) x))`,
  },
]);
assert.equal(bad.ok, false);
assert.ok(bad.failures.some((f) => /start with \(mod/.test(f)));
assert.ok(bad.failures.some((f) => /Common Lisp/.test(f)));

const stillBad = verifyWorkspaceFiles([
  {
    path: "puzzles/mtt_pool.clsp",
    content: `(mod (A)
  (if (AGG_SIG_ME A sig) (list) (list))
  (list CREATE_COIN winner_phs[0] 1)
)`,
  },
]);
assert.equal(stillBad.ok, false);
assert.ok(stillBad.failures.some((f) => /AGG_SIG_ME/.test(f)));
assert.ok(stillBad.failures.some((f) => /index syntax/.test(f)));

const ok = verifyWorkspaceFiles([
  {
    path: "puzzles/mtt_pool.clsp",
    content: `(mod (BUY_IN AUTHORIZER_PK mode w1 w2 w3)
  (list
    (list 50 AUTHORIZER_PK (sha256tree (list w1 w2 w3)))
    (list 51 w1 (quotient (* BUY_IN 50) 100))
  )
)`,
  },
]);
assert.equal(ok.ok, true);

console.log("verify.test.mjs ok");
