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

/** True if string looks like CLVM hex bytecode (not ChiaLisp source). */
export function looksLikeClvmHex(s) {
  const t = String(s || "").replace(/\s+/g, "");
  return t.length >= 8 && /^[0-9a-fA-F]+$/.test(t);
}

/**
 * @param {{ program?: string, solution?: string, mode?: "brun"|"run", expect?: string }} args
 */
export async function clvmVerify(args = {}) {
  const programRaw = String(args.program || "").trim();
  if (!programRaw) {
    return { ok: false, error: "program required (CLVM/ChiaLisp source or hex)" };
  }
  if (programRaw.length > 20_000) {
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
    const programHex = looksLikeClvmHex(programRaw)
      ? programRaw.replace(/\s+/g, "")
      : null;

    const output = captureStdout(() => {
      if (mode === "run") {
        if (solution !== undefined) clvm_tools.go("run", programRaw, solution);
        else clvm_tools.go("run", programRaw);
        return;
      }

      // brun on hex: clvm_tools `-x` treats BOTH program and env as hex, so
      // opc the solution first. Plain `brun <hex> <src>` misreads hex as IR
      // and fails with "path into atom".
      if (programHex) {
        const envSrc = solution ?? "()";
        const envHex = captureStdout(() => clvm_tools.go("opc", envSrc))
          .replace(/\s+/g, "")
          .replace(/^0x/i, "");
        if (!envHex || /fail|error|invalid/i.test(envHex)) {
          throw new Error(`opc failed for solution: ${envHex || "(empty)"}`);
        }
        clvm_tools.go("brun", "-x", programHex, envHex);
        return;
      }

      clvm_tools.go("brun", programRaw, solution ?? "()");
    });

    const failed = /^FAIL:/i.test(output) || /clvm raise/i.test(output);
    const ok = !failed;
    const matched =
      expect === null ? null : normalizeClvm(output) === normalizeClvm(expect);

    return {
      ok,
      mode,
      program: programHex || programRaw,
      solution: solution ?? null,
      output,
      expect,
      matched,
      verified: ok && (expect === null || matched === true),
      engine: "clvm_tools",
      hex: Boolean(programHex),
    };
  } catch (err) {
    return {
      ok: false,
      mode,
      program: programRaw,
      solution: solution ?? null,
      error: err instanceof Error ? err.message : String(err),
      hint: "Ensure clvm_tools is installed (npm install) on the worker host.",
    };
  }
}

function normalizeClvm(s) {
  return String(s).replace(/\s+/g, " ").trim();
}
