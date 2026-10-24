import assert from "node:assert/strict";
import {
  checkCurryTreehashShape,
  LIST_CURRY_TREEHASH,
  C_CURRY_TREEHASH,
} from "./curry-check.mjs";

const wrongList = `(mod (MOD_HASH A)
  (defun ph () (sha256tree (list MOD_HASH A)))
)`;
assert.ok(LIST_CURRY_TREEHASH.test(wrongList));
assert.ok(checkCurryTreehashShape(wrongList, "bad.clsp").some((f) => /c MOD_HASH/i.test(f)));

const wrongLower = `(mod (mod_hash A)
  (defun ph () (sha256tree (list mod_hash A)))
)`;
assert.ok(checkCurryTreehashShape(wrongLower, "bad-lower.clsp").length > 0);

const good = `(mod (MOD_HASH A)
  (defun ph (mod_hash a)
    (sha256tree (c mod_hash (list a)))
  )
)`;
assert.ok(C_CURRY_TREEHASH.test(good));
assert.deepEqual(checkCurryTreehashShape(good), []);

console.log("curry-check.test.mjs ok");
