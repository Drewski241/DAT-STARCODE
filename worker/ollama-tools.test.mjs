import assert from "node:assert/strict";
import {
  toOllamaTools,
  normalizeToolArgs,
  mergeToolCalls,
  firstToolCallAction,
  trimMessagesForContext,
} from "./ollama-tools.mjs";

const tools = toOllamaTools();
assert.ok(tools.some((t) => t.function.name === "str_replace"));
assert.ok(tools.some((t) => t.function.name === "check_url"));
const general = toOllamaTools(undefined, { general: true });
assert.equal(general.every((t) => ["web_search", "fetch_url"].includes(t.function.name)), true);

assert.deepEqual(normalizeToolArgs('{"path":"a.ts"}'), { path: "a.ts" });
assert.deepEqual(normalizeToolArgs({ path: "b" }), { path: "b" });

const merged = mergeToolCalls([], [
  { index: 0, function: { name: "read_file", arguments: '{"path":' } },
  { index: 0, function: { arguments: '"x.ts"}' } },
]);
const action = firstToolCallAction(merged);
assert.equal(action?.tool, "read_file");
assert.equal(action?.args.path, "x.ts");

const msgs = [
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
  { role: "assistant", content: "tool" },
  { role: "user", content: `OBSERVATION:\n${"x".repeat(20_000)}` },
  { role: "assistant", content: "more" },
  { role: "user", content: `OBSERVATION:\n${"y".repeat(20_000)}` },
];
const trimmed = trimMessagesForContext(msgs, { maxChars: 8_000 });
assert.ok(trimmed[0].role === "system");
assert.ok(
  trimmed.reduce((n, m) => n + String(m.content).length, 0) < 25_000,
);

console.log("ollama-tools.test.mjs ok");
