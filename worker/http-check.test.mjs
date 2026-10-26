import assert from "node:assert/strict";
import http from "http";
import { extractListenUrls, checkHttpUrl } from "./http-check.mjs";

assert.deepEqual(
  extractListenUrls("Server running at http://127.0.0.1:3000/"),
  ["http://127.0.0.1:3000/"],
);
assert.ok(
  extractListenUrls("listening on 0.0.0.0:4173").some((u) =>
    u.includes("127.0.0.1:4173"),
  ) || extractListenUrls("READY 4173")[0]?.includes("4173"),
);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<html><title>Forge</title><body>ok</body></html>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = /** @type {import('net').AddressInfo} */ (server.address());
const hit = await checkHttpUrl(`http://127.0.0.1:${port}/`);
assert.equal(hit.ok, true);
assert.equal(hit.title, "Forge");
const blocked = await checkHttpUrl("https://example.com/");
assert.equal(blocked.ok, false);
server.close();

console.log("http-check.test.mjs ok");
