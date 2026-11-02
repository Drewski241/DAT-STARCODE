#!/usr/bin/env node
/**
 * Rust / Rue routing and static checks. No Ollama, no compiler required.
 */
import assert from "node:assert/strict";
import { inferGoal, inferGoalForTurn } from "./goals.mjs";
import {
  planLanguageCompile,
  rueMainMissingReturn,
  verifyLanguageDeliverables,
} from "./lang-verify.mjs";

const rust = inferGoal("Write a Rust CLI that prints hello");
assert.equal(rust.id, "rust");
assert.equal(rust.hard, true);
assert.equal(rust.wantCdv, false);
assert.deepEqual(rust.langs, ["rust"]);
assert.deepEqual(rust.playbooks, ["rust.md"]);

const rue = inferGoal("Implement a Rue program in hello.rue");
assert.equal(rue.id, "rue");
assert.equal(rue.hard, true);
assert.equal(rue.wantCdv, false);
assert.deepEqual(rue.langs, ["rue"]);
assert.deepEqual(rue.playbooks, ["rue.md"]);

const both = inferGoal("Write rust and rue helpers");
assert.equal(both.id, "rust");
assert.equal(both.label, "Rust and Rue");
assert.deepEqual(both.langs, ["rust", "rue"]);
assert.deepEqual(both.playbooks, ["rust.md", "rue.md"]);

const trust = inferGoal("I trust this code");
assert.notEqual(trust.id, "rust");
assert.equal(trust.id, "coding");

const english = inferGoal("true rule cruel");
assert.equal(english.id, "general");

const chia = inferGoal("Write a ChiaLisp puzzle in puzzles/vault.clsp");
assert.equal(chia.id, "chialisp");
assert.equal(chia.wantCdv, true);

const mtt = inferGoal("Write puzzles/mtt_pool.clsp for ChiaLisp");
assert.equal(mtt.id, "mtt_pool");
assert.equal(mtt.wantCdv, true);

const poisoned = [
  "### Prior user request",
  "Write a Rust CLI",
  "",
  "### Prior workspace files (continue from these)",
  "#### File: puzzles/vault.clsp",
  "(mod (AGG_SIG_ME",
].join("\n");
const stay = inferGoalForTurn("Write a Rust CLI in src/main.rs", poisoned);
assert.equal(stay.id, "rust");
assert.equal(stay.wantCdv, false);

const follow = inferGoalForTurn("add a unit test", poisoned);
assert.equal(follow.id, "rust");
assert.deepEqual(follow.langs, ["rust"]);

const web = inferGoalForTurn("Build a React website", poisoned);
assert.equal(web.id, "coding");
assert.equal(web.wantCdv, false);

const py = verifyLanguageDeliverables(
  [{ path: "src/main.rs", content: "def main():\n    pass\n" }],
  { langs: ["rust"] },
);
assert.equal(py.ok, false);
assert.match(py.failures.join("\n"), /def/);

const js = verifyLanguageDeliverables(
  [{ path: "main.rs", content: "function main() { return 1 }\n" }],
  { langs: ["rust"] },
);
assert.equal(js.ok, false);
assert.match(js.failures.join("\n"), /function/);

const go = verifyLanguageDeliverables(
  [{ path: "main.rs", content: "package main\nfunc main() {}\n" }],
  { langs: ["rust"] },
);
assert.equal(go.ok, false);
assert.match(go.failures.join("\n"), /package main/);

const goodRs = verifyLanguageDeliverables(
  [{ path: "src/main.rs", content: "fn main() {\n    println!(\"hello\");\n}\n" }],
  { langs: ["rust"] },
);
assert.equal(goodRs.ok, true);

const missingRs = verifyLanguageDeliverables(
  [{ path: "README.md", content: "todo" }],
  { langs: ["rust"] },
);
assert.equal(missingRs.ok, false);
assert.match(missingRs.failures.join("\n"), /\.rs/);

const macro = verifyLanguageDeliverables(
  [{ path: "hello.rue", content: "fn main() -> i32 {\n    println!(\"hi\");\n    0\n}\n" }],
  { langs: ["rue"] },
);
assert.equal(macro.ok, false);
assert.match(macro.failures.join("\n"), /println!/);

const impl = verifyLanguageDeliverables(
  [
    {
      path: "hello.rue",
      content: "struct Foo { n: i32 }\nimpl Foo {}\nfn main() -> i32 { 0 }\n",
    },
  ],
  { langs: ["rue"] },
);
assert.equal(impl.ok, false);
assert.match(impl.failures.join("\n"), /impl/);

const life = verifyLanguageDeliverables(
  [{ path: "hello.rue", content: "fn main<'a>() -> i32 { 0 }\n" }],
  { langs: ["rue"] },
);
assert.equal(life.ok, false);
assert.match(life.failures.join("\n"), /lifetime/);

assert.equal(rueMainMissingReturn("fn main() { 0 }\n"), true);
const bareMain = verifyLanguageDeliverables(
  [{ path: "hello.rue", content: "fn main() { 0 }\n" }],
  { langs: ["rue"] },
);
assert.equal(bareMain.ok, false);
assert.match(bareMain.failures.join("\n"), /fn main/);

const goodRue = verifyLanguageDeliverables(
  [
    {
      path: "hello.rue",
      content:
        "fn main() -> i32 {\n    println(\"hello\");\n    @dbg(1);\n    0\n}\n",
    },
  ],
  { langs: ["rue"] },
);
assert.equal(goodRue.ok, true);

const missingRue = verifyLanguageDeliverables([], { langs: ["rue"] });
assert.equal(missingRue.ok, false);

const none = async () => "";
const cargoPlan = await planLanguageCompile("/tmp", {
  langs: ["rust"],
  hasCargoToml: true,
  lookPath: async (bin) => (bin === "cargo" ? "/usr/bin/cargo" : ""),
  files: [{ path: "src/main.rs", content: "fn main() {}" }],
});
assert.deepEqual(cargoPlan.commands, ["cargo check"]);
assert.equal(cargoPlan.warnings.length, 0);

const rustcPlan = await planLanguageCompile("/tmp", {
  langs: ["rust"],
  hasCargoToml: false,
  lookPath: async (bin) => (bin === "rustc" ? "/usr/bin/rustc" : ""),
  files: [{ path: "src/main.rs", content: "fn main() {}" }],
  rustcOutDir: "/tmp/datstarcoder-rustc-test",
});
assert.equal(rustcPlan.commands.length, 1);
assert.match(rustcPlan.commands[0], /rustc --edition 2021 --emit=metadata/);
assert.match(rustcPlan.commands[0], /--crate-type bin/);

const noToolchain = await planLanguageCompile("/tmp", {
  langs: ["rust"],
  hasCargoToml: false,
  lookPath: none,
  files: [{ path: "src/main.rs", content: "fn main() {}" }],
});
assert.deepEqual(noToolchain.commands, []);
assert.match(noToolchain.warnings.join("\n"), /rustup/);

const ruePlan = await planLanguageCompile("/tmp", {
  langs: ["rue"],
  lookPath: async (bin) => (bin === "rue" ? "/opt/rue" : ""),
  files: [{ path: "hello.rue", content: "fn main() -> i32 { 0 }\n" }],
  rueOutPath: "/tmp/datstarcoder-rue-test",
});
assert.equal(ruePlan.commands.length, 1);
assert.match(ruePlan.commands[0], /\/opt\/rue/);
assert.match(ruePlan.commands[0], /-o /);

const noRue = await planLanguageCompile("/tmp", {
  langs: ["rue"],
  lookPath: none,
  env: {},
  files: [{ path: "hello.rue", content: "fn main() -> i32 { 0 }\n" }],
});
assert.deepEqual(noRue.commands, []);
assert.match(noRue.warnings.join("\n"), /not downloaded/);

console.log("lang-verify.test.mjs ok");
