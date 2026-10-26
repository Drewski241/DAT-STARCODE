/**
 * Detect thrash / no progress so the agent can early-exit with a clear ask.
 */

/**
 * Prompt is only "take a screenshot then done" — treat a successful shot as complete.
 * @param {string} prompt
 */
export function isScreenshotThenDonePrompt(prompt) {
  const p = String(prompt || "");
  if (!/\bscreenshot_url\b/i.test(p)) return false;
  if (!/\bthen done\b|\bdone\.\s*$/i.test(p)) return false;
  // Still an edit task if they also asked to rewrite files.
  if (/\b(write_file|str_replace|overwrite package\.json|scripts\.test)\b/i.test(p)) {
    return false;
  }
  return true;
}

/**
 * Intentional failing-test demo (#7): package.json test + index.js written → done.
 * @param {string} prompt
 * @param {string[]} filesTouched
 */
export function intentionalFailFilesReady(prompt, filesTouched) {
  const p = String(prompt || "");
  if (
    !/\b(do not change the test to pass|leave (the )?test failing|scripts\.test is exactly|process\.exit\(1\))\b/i.test(
      p,
    )
  ) {
    return false;
  }
  const touched = (filesTouched || []).map((f) => String(f).replace(/^\.\//, ""));
  const hasPkg = touched.some((f) => /(^|\/)package\.json$/i.test(f));
  const hasIndex = touched.some((f) => /(^|\/)index\.js$/i.test(f));
  return hasPkg && hasIndex;
}

/**
 * @param {{
 *   writes: number,
 *   runs: number,
 *   idleSteps: number,
 *   lastObservation?: string,
 *   screenshotOk?: boolean,
 * }} state
 * @param {{ maxIdle?: number, screenshotThenDone?: boolean, intentionalFailReady?: boolean }} [opts]
 */
export function shouldEarlyExit(state, opts = {}) {
  if (opts.screenshotThenDone && state.screenshotOk) {
    return {
      exit: true,
      reason:
        "Screenshot captured — reply done with Preview screenshot path; do not start unrelated ChiaLisp / file edits.",
      doneMessage:
        "Preview screenshot saved under .datstarcoder/ — open Preview screenshot in Studio.",
    };
  }
  if (opts.intentionalFailReady && Number(state.writes || 0) >= 2) {
    return {
      exit: true,
      reason:
        "Intentional failing test files written — call done; do not change the test to pass.",
      doneMessage:
        "Wrote package.json (scripts.test → process.exit(1)) and index.js. Left the test failing as requested.",
    };
  }
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
 * @param {{ writes: number, runs: number, idleSteps: number, lastWritePath?: string, screenshotOk?: boolean }} state
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
  } else if (tool === "run" || tool === "start_server" || tool === "npm_install" || tool === "check_url" || tool === "screenshot_url") {
    next.runs = (next.runs || 0) + 1;
    next.idleSteps = 0;
    if (tool === "screenshot_url") {
      // captureScreenshot returns JSON { ok: true, ... }
      next.screenshotOk =
        /"ok"\s*:\s*true/i.test(obs) || /^OK\b/i.test(obs.trim());
    }
  } else if (tool === "read_file" || tool === "list_files") {
    next.idleSteps = (next.idleSteps || 0) + 1;
  } else {
    next.idleSteps = (next.idleSteps || 0) + 1;
  }
  return next;
}
