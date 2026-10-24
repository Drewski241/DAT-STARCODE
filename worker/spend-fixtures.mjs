/**
 * Load templates/secure-treasury/tests/spend-samples.json and run fail-closed
 * spend checks. Compiles via cdv when available; compile errors never count
 * as expectFail successes (that was a false green).
 */
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { spendCheck } from "./spend-check.mjs";
import { cdvAvailable } from "./cdv.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const DEFAULT_FIXTURE = path.join(
  repoRoot,
  "templates/secure-treasury/tests/spend-samples.json",
);

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, stdout, stderr: `${stderr}\ntimeout` });
    }, opts.timeoutMs || 90_000);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function isCompileFailure(row) {
  const blob = `${row?.error || ""} ${row?.output || ""}`;
  return /can't compile|unknown operator|SyntaxError|parse error/i.test(blob);
}

/**
 * Compile .clsp → hex with cdv; return hex program text or null.
 * @param {string} workspaceRoot
 * @param {string} rel
 */
async function compileClsp(workspaceRoot, rel) {
  const includeFlags = [];
  for (const inc of ["include", "templates/secure-treasury/include"]) {
    try {
      await fs.access(path.join(workspaceRoot, inc));
      includeFlags.push("-i", inc);
    } catch {
      /* missing */
    }
  }
  const build = await run("cdv", ["clsp", "build", rel, ...includeFlags], {
    cwd: workspaceRoot,
    timeoutMs: 90_000,
  });
  const hexRel = `${rel}.hex`;
  try {
    const hex = (await fs.readFile(path.join(workspaceRoot, hexRel), "utf8")).trim();
    if (hex && build.code === 0) {
      return { ok: true, program: hex, hexRel, log: `${build.stdout}\n${build.stderr}` };
    }
  } catch {
    /* fall through */
  }
  return {
    ok: false,
    program: null,
    hexRel,
    log: `${build.stdout}\n${build.stderr}`.trim() || `cdv build failed (code ${build.code})`,
  };
}

/**
 * @param {string} workspaceRoot
 * @param {{ log?: (m: string) => void, fixturePath?: string }} [opts]
 */
export async function runSecureTreasurySpendFixtures(workspaceRoot, opts = {}) {
  const log = opts.log || (() => {});
  const fixturePath = opts.fixturePath || DEFAULT_FIXTURE;

  let raw;
  try {
    raw = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  } catch (err) {
    // Prefer workspace copy when seeded.
    try {
      raw = JSON.parse(
        await fs.readFile(
          path.join(workspaceRoot, "tests/spend-samples.json"),
          "utf8",
        ),
      );
    } catch {
      return {
        ok: false,
        message: `spend fixtures missing: ${err instanceof Error ? err.message : String(err)}`,
        results: [],
      };
    }
  }

  const hasCdv = await cdvAvailable();
  if (!hasCdv) {
    return {
      ok: false,
      message:
        "spend fixtures require cdv (chia-dev-tools) to compile .clsp before brun — install on the worker and retry",
      results: [],
      skippedCompile: true,
    };
  }

  const programs = raw.programs || {};
  const results = [];
  let ok = true;

  for (const [rel, spec] of Object.entries(programs)) {
    try {
      await fs.access(path.join(workspaceRoot, rel));
    } catch {
      ok = false;
      results.push({
        path: rel,
        ok: false,
        error: `file not found in workspace: ${rel}`,
      });
      continue;
    }

    const compiled = await compileClsp(workspaceRoot, rel);
    if (!compiled.ok || !compiled.program) {
      ok = false;
      results.push({
        path: rel,
        ok: false,
        error: `cdv compile failed: ${(compiled.log || "").slice(0, 400)}`,
      });
      log(`[spend-fixtures] FAIL ${rel} :: compile`);
      continue;
    }

    const samples = Array.isArray(spec.samples) ? spec.samples : [];
    for (const sample of samples) {
      const checked = await spendCheck({
        program: compiled.program,
        samples: [
          {
            name: sample.name,
            solution: sample.solution,
            mode: "brun",
          },
        ],
      });
      const row = checked.results[0] || { ok: false };
      if (isCompileFailure(row)) {
        ok = false;
        results.push({
          path: rel,
          name: sample.name,
          ok: false,
          expectFail: Boolean(sample.expectFail),
          error: `compile/runtime tooling error (not a valid expectFail): ${row.error || row.output}`,
          why: sample.why || null,
        });
        log(`[spend-fixtures] FAIL ${rel} :: ${sample.name} (tooling)`);
        continue;
      }

      const failedClosed = !row.ok;
      const expectFail = Boolean(sample.expectFail);
      const pass = expectFail ? failedClosed : Boolean(row.ok);
      if (!pass) ok = false;
      results.push({
        path: rel,
        name: sample.name,
        ok: pass,
        expectFail,
        output: row.output || null,
        error: row.error || null,
        why: sample.why || null,
      });
      log(
        `[spend-fixtures] ${pass ? "ok" : "FAIL"} ${rel} :: ${sample.name}` +
          (sample.why ? ` (${sample.why})` : ""),
      );
    }
  }

  return {
    ok,
    message: ok
      ? `spend fixtures passed (${results.length})`
      : `spend fixtures failed (${results.filter((r) => !r.ok).length}/${results.length})`,
    results,
  };
}
