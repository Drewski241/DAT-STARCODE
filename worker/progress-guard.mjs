/**
 * Detect thrash / no progress so the agent can early-exit with a clear ask.
 */

/**
 * @param {{
 *   writes: number,
 *   runs: number,
 *   idleSteps: number,
 *   lastObservation?: string,
 * }} state
 * @param {{ maxIdle?: number }} [opts]
 */
export function shouldEarlyExit(state, opts = {}) {
  const maxIdle = opts.maxIdle ?? 6;
  const idle = Number(state.idleSteps || 0);
  if (idle >= maxIdle && Number(state.writes || 0) === 0) {
    return {
      exit: true,
      reason:
        "No file changes after several steps — stop thrashing; ask the user for the failing command or a narrower target file.",
    };
  }
  if (
    idle >= maxIdle + 2 &&
    Number(state.writes || 0) > 0 &&
    Number(state.runs || 0) === 0
  ) {
    return {
      exit: true,
      reason:
        "Edits made but never re-ran the failing command — summarize changes and ask user to confirm next verify step.",
    };
  }
  return { exit: false, reason: "" };
}

/**
 * @param {string} tool
 * @param {string} observation
 * @param {{ writes: number, runs: number, idleSteps: number, lastWritePath?: string }} state
 */
export function updateProgressState(tool, observation, state) {
  const next = { ...state };
  const obs = String(observation || "");
  if (
    (tool === "write_file" && /^OK wrote /i.test(obs)) ||
    (tool === "str_replace" && /^OK str_replace /i.test(obs))
  ) {
    next.writes = (next.writes || 0) + 1;
    next.idleSteps = 0;
    const m =
      obs.match(/^OK wrote (\S+)/i) || obs.match(/^OK str_replace (\S+)/i);
    if (m) next.lastWritePath = m[1];
  } else if (tool === "run" || tool === "start_server" || tool === "npm_install") {
    next.runs = (next.runs || 0) + 1;
    next.idleSteps = 0;
  } else if (tool === "read_file" || tool === "list_files") {
    next.idleSteps = (next.idleSteps || 0) + 1;
  } else {
    next.idleSteps = (next.idleSteps || 0) + 1;
  }
  return next;
}
