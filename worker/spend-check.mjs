/**
 * Lightweight spend-shape check via clvm_tools brun/run.
 * Not a full chia simulator — catches raise/FAIL and optional expect match.
 */
import { clvmVerify } from "./clvm-verify.mjs";

/**
 * @param {{
 *   program: string,
 *   samples?: { name?: string, solution?: string, mode?: "brun"|"run", expect?: string }[],
 * }} input
 */
export async function spendCheck(input = {}) {
  const program = String(input.program || "").trim();
  if (!program) {
    return { ok: false, error: "program required", results: [] };
  }
  const samples =
    Array.isArray(input.samples) && input.samples.length
      ? input.samples
      : [{ name: "default", solution: "()", mode: "brun" }];

  const results = [];
  for (const sample of samples) {
    const name = sample.name || "sample";
    const verified = await clvmVerify({
      program,
      solution: sample.solution,
      mode: sample.mode || "brun",
      expect: sample.expect,
    });
    results.push({
      name,
      ok: Boolean(verified.verified ?? verified.ok),
      output: verified.output || null,
      error: verified.error || null,
      matched: verified.matched ?? null,
    });
  }

  const ok = results.every((r) => r.ok);
  return {
    ok,
    engine: "clvm_tools",
    note: "Spend-check uses brun/run only — not a full mempool/spend-bundle simulator.",
    results,
  };
}
