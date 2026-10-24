/**
 * Probe worker-side ChiaLisp / CLVM tooling.
 * Hard-domain (.clsp) jobs require both cdv and clvm_tools unless explicitly waived.
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { cdvAvailable } from "./cdv.mjs";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json"),
);

let cachedClvm = null;

/**
 * Whether hard ChiaLisp jobs must have cdv + clvm_tools.
 * Default: required. Set REQUIRE_CHIALISP_TOOLING=0 only for emergency demos.
 */
export function chialispToolingRequired() {
  const raw = process.env.REQUIRE_CHIALISP_TOOLING;
  if (raw === undefined || raw === "") return true;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

/** @returns {Promise<boolean>} */
export async function clvmToolsAvailable() {
  if (cachedClvm != null) return cachedClvm;
  try {
    const clvm_tools = require("clvm_tools");
    if (typeof clvm_tools.initialize === "function") {
      await clvm_tools.initialize();
    }
    if (typeof clvm_tools.go !== "function") {
      cachedClvm = false;
      return false;
    }
    cachedClvm = true;
    return true;
  } catch {
    cachedClvm = false;
    return false;
  }
}

/**
 * @returns {Promise<{
 *   required: boolean,
 *   cdv: boolean,
 *   clvmTools: boolean,
 *   ok: boolean,
 *   missing: string[],
 *   installHints: string[],
 * }>}
 */
export async function probeChialispTooling() {
  const required = chialispToolingRequired();
  const [cdv, clvmTools] = await Promise.all([
    cdvAvailable(),
    clvmToolsAvailable(),
  ]);
  const missing = [];
  const installHints = [];
  if (!cdv) {
    missing.push("cdv");
    installHints.push(
      "Install chia-dev-tools on the GPU box: pipx install chia-dev-tools  (then ensure `cdv` is on PATH)",
    );
  }
  if (!clvmTools) {
    missing.push("clvm_tools");
    installHints.push(
      "Install npm deps on the worker host: npm install  (provides clvm_tools for brun/run)",
    );
  }
  return {
    required,
    cdv,
    clvmTools,
    ok: missing.length === 0,
    missing,
    installHints,
  };
}

/**
 * Human-readable failure lines for job results / logs.
 * @param {Awaited<ReturnType<typeof probeChialispTooling>>} probe
 */
export function toolingFailureLines(probe) {
  if (probe.ok) return [];
  return [
    `ChiaLisp tooling missing on this worker: ${probe.missing.join(", ")}.`,
    ...probe.installHints,
    probe.required
      ? "Hard-domain ChiaLisp jobs require these tools (set REQUIRE_CHIALISP_TOOLING=0 only to waive)."
      : "REQUIRE_CHIALISP_TOOLING is off — hash/verify steps may be skipped.",
  ];
}
