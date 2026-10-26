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

// Rebuild .png.b64 from a valid binary PNG when sidecar is missing.
{
  const rebuildRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-shot-b64-"));
  const shotDir = path.join(rebuildRoot, ".datstarcoder", "screenshots");
  await fs.mkdir(shotDir, { recursive: true });
  // Minimal valid PNG header + IHDR-ish bytes (signature check only needs 0x89PNG)
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  await fs.writeFile(path.join(shotDir, "rebuilt.png"), png);
  const listed = await ensurePreviewFilesListed(rebuildRoot, [
    { path: ".datstarcoder/screenshots/rebuilt.png", content: "mangled" },
  ]);
  assert.ok(
    listed.some((f) => f.path === ".datstarcoder/screenshots/rebuilt.png.b64"),
  );
  assert.ok(
    !listed.some(
      (f) => f.path === ".datstarcoder/screenshots/rebuilt.png",
    ),
  );
  await fs.rm(rebuildRoot, { recursive: true, force: true });
  console.log("screenshot.test.mjs ok (b64 rebuild)");
}

// Workspace-relative HTML → file:// (no HTTP server required for path resolve)
{
  const fileRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-shot-file-"));
  await fs.writeFile(
    path.join(fileRoot, "index.html"),
    "<html><title>File</title><body>file</body></html>",
    "utf8",
  );
  const fileShot = await captureScreenshot(fileRoot, {
    url: "index.html",
    name: "filehtml",
  });
  if (pw) {
    assert.equal(fileShot.ok, true, fileShot.message);
    assert.match(String(fileShot.url || ""), /^file:/);
  } else {
    assert.equal(fileShot.ok, false);
    assert.match(String(fileShot.message), /Playwright not installed/i);
  }
  await fs.rm(fileRoot, { recursive: true, force: true });
}
