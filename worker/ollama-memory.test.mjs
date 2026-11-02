#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  isHeavyOllamaModel,
  releaseLoadedHeavyModels,
  unloadHeavyAfterJob,
} from "./ollama-memory.mjs";

assert.equal(isHeavyOllamaModel("qwen2.5-coder:32b"), true);
assert.equal(isHeavyOllamaModel("qwen2.5-coder:14b"), true);
assert.equal(isHeavyOllamaModel("llama3.1:70b"), true);
assert.equal(isHeavyOllamaModel("qwen2.5-coder:72b"), true);
assert.equal(isHeavyOllamaModel("qwen2.5-coder:7b"), false);
assert.equal(isHeavyOllamaModel("qwen2.5:7b"), false);
assert.equal(isHeavyOllamaModel("llama3.1:8b"), false);

assert.equal(unloadHeavyAfterJob({}), true);
assert.equal(unloadHeavyAfterJob({ OLLAMA_UNLOAD_HEAVY: "0" }), false);
assert.equal(unloadHeavyAfterJob({ OLLAMA_UNLOAD_HEAVY: "off" }), false);
assert.equal(unloadHeavyAfterJob({ OLLAMA_UNLOAD_HEAVY: "1" }), true);

const calls = [];
const fetchImpl = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/api/ps")) {
    return {
      ok: true,
      json: async () => ({
        models: [
          { name: "qwen2.5-coder:32b" },
          { name: "qwen2.5-coder:7b" },
          { model: "llama3.1:8b" },
        ],
      }),
      text: async () => "",
    };
  }
  return { ok: true, json: async () => ({}), text: async () => "" };
};

const unloaded = await releaseLoadedHeavyModels("http://127.0.0.1:11434/", {
  fetchImpl,
  env: {},
});
assert.deepEqual(unloaded, ["qwen2.5-coder:32b"]);
assert.equal(calls.length, 2);
assert.match(calls[1].url, /\/api\/generate$/);
const sent = JSON.parse(calls[1].init.body);
assert.equal(sent.model, "qwen2.5-coder:32b");
assert.equal(sent.keep_alive, 0);
assert.equal(sent.stream, false);

calls.length = 0;
const skipped = await releaseLoadedHeavyModels("http://127.0.0.1:11434", {
  fetchImpl,
  env: { OLLAMA_UNLOAD_HEAVY: "0" },
});
assert.deepEqual(skipped, []);
assert.equal(calls.length, 0);

console.log("ollama-memory.test.mjs ok");
