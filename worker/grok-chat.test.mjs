import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import { grokChat, isGrokModel } from "./grok-chat.mjs";

const ORIGINAL = {
  key: process.env.XAI_API_KEY,
  base: process.env.XAI_BASE_URL,
  model: process.env.XAI_MODEL,
};

afterEach(() => {
  if (ORIGINAL.key === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = ORIGINAL.key;
  if (ORIGINAL.base === undefined) delete process.env.XAI_BASE_URL;
  else process.env.XAI_BASE_URL = ORIGINAL.base;
  if (ORIGINAL.model === undefined) delete process.env.XAI_MODEL;
  else process.env.XAI_MODEL = ORIGINAL.model;
});

describe("grokChat", { concurrency: false }, () => {
  it("recognizes grok model ids", () => {
    assert.equal(isGrokModel("grok-4.7"), true);
    assert.equal(isGrokModel("qwen2.5-coder:32b"), false);
  });

  it("refuses to call the API when the key is missing", async () => {
    delete process.env.XAI_API_KEY;
    await assert.rejects(
      () => grokChat("grok-4.7", [{ role: "user", content: "Fix the race." }]),
      /XAI_API_KEY is not set/,
    );
  });

  it("posts the agent turn and returns tool calls", async () => {
    let body = "";
    const server = createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        body = Buffer.concat(chunks).toString("utf8");
        assert.equal(req.headers.authorization, "Bearer test-key");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "Reading the claim path.",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "read_file",
                        arguments: "{\"path\":\"src/lib/store.ts\"}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    process.env.XAI_API_KEY = "test-key";
    process.env.XAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
    delete process.env.XAI_MODEL;

    try {
      const reply = await grokChat(
        "grok-4.7",
        [
          { role: "system", content: "You are DAT STARCODER." },
          { role: "user", content: "Fix the deadlock in claimNextJob." },
        ],
        undefined,
        {
          tools: [
            {
              type: "function",
              function: { name: "read_file", parameters: { type: "object" } },
            },
          ],
        },
      );
      const sent = JSON.parse(body);
      assert.equal(sent.model, "grok-4.7");
      assert.equal(sent.messages[1].content.includes("deadlock"), true);
      assert.equal(sent.tools[0].function.name, "read_file");
      assert.equal(reply.content, "Reading the claim path.");
      assert.equal(reply.toolCalls[0].function.name, "read_file");
      assert.equal(
        reply.toolCalls[0].function.arguments,
        "{\"path\":\"src/lib/store.ts\"}",
      );
    } finally {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
