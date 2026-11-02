import assert from "node:assert/strict";
import { resolveModel } from "../src/lib/models";

const hard = resolveModel("auto", "Write puzzles/mtt_pool.clsp for ChiaLisp");
assert.equal(hard.resolved, "qwen2.5-coder:32b");
assert.match(hard.reason, /32b/);

const complex = resolveModel(
  "auto",
  "Refactor the Next.js auth flow across multiple files",
);
assert.equal(complex.resolved, "qwen2.5-coder:32b");

const light = resolveModel("auto", "Fix the login button label in the component");
assert.equal(light.resolved, "qwen2.5-coder:7b");

const general = resolveModel("auto", "What is the capital of France?");
assert.equal(general.resolved, "llama3.1:8b");

const rust = resolveModel("auto", "Write a small Rust CLI in main.rs");
assert.equal(rust.resolved, "qwen2.5-coder:32b");

const rue = resolveModel("auto", "Write a Rue program in hello.rue");
assert.equal(rue.resolved, "qwen2.5-coder:32b");

const trust = resolveModel("auto", "I trust this code");
assert.equal(trust.resolved, "qwen2.5-coder:7b");

const explicit = resolveModel("qwen2.5-coder:14b", "Write a ChiaLisp puzzle");
assert.equal(explicit.resolved, "qwen2.5-coder:14b");

console.log("model-routing.test.ts ok");
