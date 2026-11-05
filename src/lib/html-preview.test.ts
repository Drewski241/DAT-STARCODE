import assert from "node:assert/strict";
import { bundleHtmlPreview, resolveWorkspaceHref } from "./html-preview";

assert.equal(resolveWorkspaceHref("index.html", "styles.css"), "styles.css");
assert.equal(
  resolveWorkspaceHref("src/index.html", "../styles.css"),
  "styles.css",
);
assert.equal(
  resolveWorkspaceHref("index.html", "/css/app.css"),
  "css/app.css",
);
assert.equal(resolveWorkspaceHref("index.html", "https://cdn.example/a.css"), null);
assert.equal(resolveWorkspaceHref("index.html", "../secret.css"), null);
assert.equal(resolveWorkspaceHref("index.html", "#top"), null);

const files = new Map<string, string>([
  [
    "index.html",
    `<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="styles.css" />
    <link rel="stylesheet" href="https://cdn.example/remote.css" />
  </head>
  <body>
    <h1 id="title">Hi</h1>
    <script src="app.js"></script>
    <script src="https://cdn.example/remote.js"></script>
  </body>
</html>`,
  ],
  ["styles.css", "h1 { color: #c4a574; } /* </style> */"],
  ["app.js", "document.getElementById('title').textContent = 'Ready </script>';"],
  ["nested/index.html", `<link rel="stylesheet" href="../styles.css" />`],
]);

async function main() {
  const bundled = await bundleHtmlPreview(
    "index.html",
    async (rel) => files.get(rel) ?? null,
  );
  assert.ok(bundled);
  assert.match(bundled, /<style data-workspace-src="styles.css">/);
  assert.match(bundled, /color: #c4a574/);
  assert.match(bundled, /<\\\/style>/);
  assert.match(bundled, /https:\/\/cdn\.example\/remote\.css/);
  assert.doesNotMatch(bundled, /src="app\.js"/);
  assert.match(bundled, /textContent = 'Ready <\\\/script>'/);
  assert.match(bundled, /src="https:\/\/cdn\.example\/remote\.js"/);

  const nested = await bundleHtmlPreview(
    "nested/index.html",
    async (rel) => files.get(rel) ?? null,
  );
  assert.match(nested || "", /data-workspace-src="styles.css"/);
  assert.equal(await bundleHtmlPreview("missing.html", async () => null), null);
  assert.equal(await bundleHtmlPreview("app.js", async () => "nope"), null);
  console.log("html-preview.test.ts ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
