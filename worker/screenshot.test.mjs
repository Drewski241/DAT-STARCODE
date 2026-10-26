import assert from "node:assert/strict";
import { promises as fs } from "fs";
import http from "http";
import os from "os";
import path from "path";
import {
  captureScreenshot,
  ensurePreviewFilesListed,
  loadPlaywright,
  PREVIEW_JSON_REL,
} from "./screenshot.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-shot-"));
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<html><title>Shot</title><body>hi</body></html>");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = /** @type {import('net').AddressInfo} */ (server.address());
const url = `http://127.0.0.1:${port}/`;

const pw = await loadPlaywright();
const result = await captureScreenshot(root, { url, name: "unit" });
if (pw) {
  assert.equal(result.ok, true, result.message);
  assert.ok(result.b64Rel);
  const listed = await ensurePreviewFilesListed(root, []);
  assert.ok(listed.some((f) => f.path === PREVIEW_JSON_REL || f.path.endsWith(".meta.json")));
  assert.ok(listed.some((f) => f.path.endsWith(".png.b64")));
  console.log("screenshot.test.mjs ok (playwright)");
} else {
  assert.equal(result.ok, false);
  assert.match(String(result.message), /Playwright not installed/i);
  assert.equal(result.probe?.ok, true);
  console.log("screenshot.test.mjs ok (fallback without playwright)");
}

server.close();
