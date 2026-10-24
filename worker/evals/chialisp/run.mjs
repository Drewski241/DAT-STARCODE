#!/usr/bin/env node
/**
 * Offline ChiaLisp verification evals (no Ollama required).
 * Run: node worker/evals/chialisp/run.mjs
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { verifyWorkspaceFiles } from "../../verify.mjs";
import { findBarePuzzleHash } from "../../verify.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");

async function read(name) {
  return fs.readFile(path.join(fixtures, name), "utf8");
}

const cases = [
  {
    id: "golden-minimal",
    expectOk: true,
    files: async () => [
      {
        path: "puzzles/golden.clsp",
        content: await read("golden-minimal.clsp"),
      },
      {
        path: "docs/MTT_POOL.md",
        content: await read("golden-pool-hash.md"),
      },
    ],
    opts: { requireHash: true },
  },
  {
    id: "trap-common-lisp",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/bad.clsp",
        content: await read("trap-common-lisp.clsp"),
      },
    ],
  },
  {
    id: "trap-agg-sig-as-if",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/bad.clsp",
        content: await read("trap-agg-sig-as-if.clsp"),
      },
    ],
  },
  {
    id: "trap-deadbeef",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/bad.clsp",
        content: await read("trap-deadbeef.clsp"),
      },
    ],
  },
  {
    id: "trap-index-syntax",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/bad.clsp",
        content: await read("trap-index-syntax.clsp"),
      },
    ],
  },
  {
    id: "trap-fake-ox-hash",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/ok.clsp",
        content: await read("golden-minimal.clsp"),
      },
      {
        path: "docs/MTT_POOL.md",
        content: await read("trap-fake-ox-hash.md"),
      },
    ],
    opts: { requireHash: true },
  },
  {
    id: "tooling-required",
    expectOk: false,
    files: async () => [
      {
        path: "puzzles/ok.clsp",
        content: await read("golden-minimal.clsp"),
      },
      {
        path: "docs/MTT_POOL.md",
        content: await read("golden-pool-hash.md"),
      },
    ],
    opts: {
      requireHash: true,
      toolingOk: false,
      toolingMissing: ["cdv", "clvm_tools"],
    },
  },
];

let failed = 0;
for (const c of cases) {
  const files = await c.files();
  const result = verifyWorkspaceFiles(files, c.opts || {});
  try {
    assert.equal(
      result.ok,
      c.expectOk,
      `${c.id}: expected ok=${c.expectOk}, got ok=${result.ok} failures=${JSON.stringify(result.failures)}`,
    );
    console.log(`ok  ${c.id}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${c.id}: ${err instanceof Error ? err.message : err}`);
  }
}

const ox = findBarePuzzleHash(await read("trap-fake-ox-hash.md"));
assert.equal(ox, null, "0x-prefixed hash must not count as bare");
const bare = findBarePuzzleHash(await read("golden-pool-hash.md"));
assert.equal(
  bare,
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
console.log("ok  bare-hash-helpers");

if (failed) {
  console.error(`\n${failed} eval case(s) failed`);
  process.exit(1);
}
console.log(`\nchialisp evals: ${cases.length + 1} passed`);
