/**
 * A tool observation that already proves the user's outcome.
 * The agent should stop instead of spending the rest of the step budget.
 */

/**
 * @param {string} tool
 * @param {{ command?: string }} [args]
 * @param {string} observation
 */
export function outcomeReadyFromTool(tool, args, observation) {
  const obs = String(observation || "");
  const cmd = String(args?.command || "");
  if (
    tool === "run" &&
    /\bcargo\s+(check|test|build)\b/.test(cmd) &&
    /^exit 0\b/m.test(obs)
  ) {
    return {
      ready: true,
      kind: "cargo",
      message: `Passed \`${cmd}\`. The Rust project builds.`,
    };
  }
  const hash = obs.match(/puzzle hash:\s*([0-9a-f]{64})/i);
  if (
    tool === "puzzle_hash" &&
    hash &&
    !/^([0-9a-f])\1{63}$/i.test(hash[1])
  ) {
    return {
      ready: true,
      kind: "hash",
      message: "Puzzle hash is documented. This turn can stop.",
    };
  }
  return { ready: false, kind: "", message: "" };
}
