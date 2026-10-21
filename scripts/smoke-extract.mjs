import assert from "node:assert/strict";

// Mirror of extractFilesFromMarkdown for a quick node smoke (no TS loader).
function extract(markdown) {
  const files = [];
  const seen = new Set();
  const fenceRe = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = fenceRe.exec(markdown)) !== null) {
    const header = match[1].trim();
    const content = match[2].replace(/\n$/, "");
    let path = null;
    const colon = header.match(
      /^(?:[\w.+-]+\s*:)?\s*([A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+)\s*$/,
    );
    if (colon?.[1]) path = colon[1];
    if (!path) {
      const before = markdown.slice(Math.max(0, match.index - 240), match.index);
      const label = before.match(
        /(?:File|Path|Filename)\s*[:\-]\s*`?([A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+)`?/i,
      );
      if (label?.[1]) path = label[1];
    }
    if (!path || seen.has(path)) continue;
    seen.add(path);
    files.push({ path, content });
  }
  return files;
}

const md = `
### File: src/hello.ts
\`\`\`ts
export const hi = "hello";
\`\`\`

\`\`\`json:config.json
{"ok":true}
\`\`\`
`;

const files = extract(md);
assert.equal(files.length, 2);
assert.equal(files[0].path, "src/hello.ts");
assert.equal(files[1].path, "config.json");
console.log("smoke-extract ok", files.map((f) => f.path));
