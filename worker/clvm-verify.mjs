/**
 * CLVM / ChiaLisp verify helper using clvm_tools (brun / run).
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json"),
);

let toolsPromise = null;

async function getTools() {
  if (!toolsPromise) {
    toolsPromise = (async () => {
      const clvm_tools = require("clvm_tools");
      if (typeof clvm_tools.initialize === "function") {
        await clvm_tools.initialize();
      }
      return clvm_tools;
    })();
  }
  return toolsPromise;
}

function captureStdout(fn) {
  let out = "";
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, enc, cb) => {
    out += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (typeof enc === "function") enc();
    else if (typeof cb === "function") cb();
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = write;
  }
  return out.trim();
}

/**
 * @param {{ program?: string, solution?: string, mode?: "brun"|"run", expect?: string }} args
 */
export async function clvmVerify(args = {}) {
  const program = String(args.program || "").trim();
  if (!program) {
    return { ok: false, error: "program required (CLVM/ChiaLisp source or hex)" };
  }
  if (program.length > 20_000) {
    return { ok: false, error: "program too large (max 20000 chars)" };
  }

  const mode = args.mode === "run" ? "run" : "brun";
  const solution =
    args.solution === undefined || args.solution === null
      ? mode === "brun"
        ? "()"
        : undefined
      : String(args.solution);
  const expect =
    args.expect === undefined || args.expect === null
      ? null
      : String(args.expect).trim();

  try {
    const clvm_tools = await getTools();
    const output = captureStdout(() => {
      if (mode === "run") {
        if (solution !== undefined) clvm_tools.go("run", program, solution);
        else clvm_tools.go("run", program);
      } else {
        clvm_tools.go("brun", program, solution ?? "()");
      }
    });

    const failed = /^FAIL:/i.test(output) || /clvm raise/i.test(output);
    const ok = !failed;
    const matched =
      expect === null ? null : normalizeClvm(output) === normalizeClvm(expect);

    return {
      ok,
      mode,
      program,
      solution: solution ?? null,
      output,
      expect,
      matched,
      verified: ok && (expect === null || matched === true),
      engine: "clvm_tools",
    };
  } catch (err) {
    return {
      ok: false,
      mode,
      program,
      solution: solution ?? null,
      error: err instanceof Error ? err.message : String(err),
      hint: "Ensure clvm_tools is installed (npm install) on the worker host.",
    };
  }
}

function normalizeClvm(s) {
  return String(s).replace(/\s+/g, " ").trim();
}
