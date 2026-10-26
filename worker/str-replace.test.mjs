import assert from "node:assert/strict";
import { applyStrReplace } from "./str-replace.mjs";

const once = applyStrReplace("hello world", {
  oldText: "world",
  newText: "DAT",
});
assert.equal(once.ok, true);
assert.equal(once.content, "hello DAT");

const miss = applyStrReplace("abc", { oldText: "zzz", newText: "y" });
assert.equal(miss.ok, false);

const multi = applyStrReplace("a a a", { oldText: "a", newText: "b" });
assert.equal(multi.ok, false);
assert.match(multi.message, /matched 3/);

const all = applyStrReplace("a a a", {
  oldText: "a",
  newText: "b",
  replaceAll: true,
});
assert.equal(all.ok, true);
assert.equal(all.content, "b b b");
assert.equal(all.replacements, 3);

console.log("str-replace.test.mjs ok");
