import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { searchWorkspace, rankSearchPaths } from "./workspace-retrieve.mjs";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-rg-"));
await fs.writeFile(
  path.join(root, "app.js"),
  "function greet() {\n  return 'DAT Forge';\n}\n",
  "utf8",
);
await fs.mkdir(path.join(root, "src"));
await fs.writeFile(path.join(root, "src", "x.ts"), "export const n = 1;\n", "utf8");

const found = await searchWorkspace(root, "DAT Forge");
assert.equal(found.ok, true);
assert.ok(found.hits.some((h) => h.path === "app.js"));
assert.ok(rankSearchPaths(found.hits)[0]);

console.log("workspace-retrieve.test.mjs ok");
