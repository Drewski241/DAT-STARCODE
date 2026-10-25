/**
 * Classify build / runtime / tooling errors so the agent can fix→re-run.
 */

/**
 * @param {string} text
 * @returns {{
 *   kind: string,
 *   confidence: number,
 *   hints: string[],
 *   suggestedCommands: string[],
 *   filesHint: string[],
 * }}
 */
export function classifyErrorLog(text) {
  const raw = String(text || "");
  const s = raw.slice(0, 20_000);
  /** @type {{ kind: string, confidence: number, hints: string[], suggestedCommands: string[], filesHint: string[] }} */
  const out = {
    kind: "unknown",
    confidence: 0.2,
    hints: ["Read the failing command output, open the cited file:line, apply a minimal fix, re-run the same command."],
    suggestedCommands: [],
    filesHint: [],
  };

  const fileHits = [
    ...s.matchAll(
      /(?:(?:Error|error|FAIL)[^\n]*?\s+|(?:at\s+)|(?:File\s+"))((?:src|app|pages|components|lib|worker|tests?|\.)[/\\][\w./\\-]+\.(?:[jt]sx?|mjs|cjs|css|json))/g,
    ),
  ].map((m) => m[1].replace(/\\/g, "/"));
  out.filesHint = [...new Set(fileHits)].slice(0, 8);

  // Gtk / atk-bridge / xdg-open noise with exit 0 — Studio "Fix this" must not hard-route.
  if (
    /Gtk-Message:|atk-bridge|Not loading module/i.test(s) &&
    !/^exit [1-9]/m.test(s) &&
    !/Cannot find module|Failed to compile|TypeError|TS\d{4}/i.test(s)
  ) {
    out.kind = "benign_noise";
    out.confidence = 0.9;
    out.hints = [
      "This is desktop/Gtk stderr noise, not a project build failure.",
      "Do not edit code for it. Tell the user to open the site URL or use Studio Preview — never xdg-open on the worker.",
    ];
    out.suggestedCommands = [];
    return out;
  }
  if (/^POLICY:.*browser/im.test(s) || /xdg-open.*blocked/i.test(s)) {
    out.kind = "benign_noise";
    out.confidence = 0.95;
    out.hints = [
      "Browser launch is blocked on purpose on the worker.",
      "Start the server if needed, then done — user opens the URL / Studio Preview.",
    ];
    out.suggestedCommands = [];
    return out;
  }

  if (/MODULE_NOT_FOUND|Cannot find module|ERR_MODULE_NOT_FOUND/i.test(s)) {
    out.kind = "deps_missing";
    out.confidence = 0.9;
    out.hints = [
      "Install missing packages (npm install / npm i <pkg>).",
      "Check import paths and package.json dependencies.",
    ];
    out.suggestedCommands = ["npm install"];
    return out;
  }
  if (
    /TS\d{4}|Type error:|is not assignable to type|Property '.*' does not exist/i.test(
      s,
    )
  ) {
    out.kind = "typescript";
    out.confidence = 0.85;
    out.hints = [
      "Open the file:line from the TypeScript error.",
      "Fix types or null checks; avoid disabling tsc unless asked.",
    ];
    out.suggestedCommands = ["npx tsc --noEmit", "npm run build"];
    return out;
  }
  if (
    /Failed to compile|next build|Module parse failed|You're importing a component that needs/i.test(
      s,
    ) ||
    (/Error:/.test(s) && /next/i.test(s) && /build|compile/i.test(s))
  ) {
    out.kind = "next_build";
    out.confidence = 0.8;
    out.hints = [
      "Fix the cited Next.js / webpack compile error, then re-run npm run build.",
      "Check 'use client', server-only imports, and env vars used at build time.",
    ];
    out.suggestedCommands = ["npm run build"];
    return out;
  }
  if (/Hydration failed|Text content does not match server-rendered/i.test(s)) {
    out.kind = "hydration";
    out.confidence = 0.85;
    out.hints = [
      "Remove browser-only values from first server render (Date.now, random, window).",
      "Align server and client markup for the cited component.",
    ];
    out.suggestedCommands = ["npm run dev"];
    return out;
  }
  if (
    /ENOENT: no such file|Cannot find file|Module not found: Can't resolve/i.test(
      s,
    )
  ) {
    out.kind = "path_missing";
    out.confidence = 0.8;
    out.hints = [
      "Create the missing file or fix the import/path typo.",
      "list_files then read_file the importer.",
    ];
    return out;
  }
  if (
    /EADDRINUSE|port \d+.*already|listen EACCES/i.test(s) ||
    (/Error:/.test(s) && /PORT|env/i.test(s) && /undefined|missing/i.test(s))
  ) {
    out.kind = "env_runtime";
    out.confidence = 0.75;
    out.hints = [
      "Check .env.example vs process.env; set missing vars.",
      "For EADDRINUSE pick another port or stop the other process.",
    ];
    out.suggestedCommands = ["npm run dev"];
    return out;
  }
  if (/eslint|Parsing error|Unexpected token/i.test(s) && /error/i.test(s)) {
    out.kind = "lint_syntax";
    out.confidence = 0.7;
    out.hints = [
      "Fix syntax at the reported line; re-run lint/build.",
    ];
    out.suggestedCommands = ["npm run lint", "npm run build"];
    return out;
  }
  // Exit code / ERROR: only — do NOT treat STDERR alone as failure
  // (xdg-open Gtk noise, npm warnings, etc. often print on stderr with exit 0).
  if (/^exit [1-9]/m.test(s) || /^ERROR:/im.test(s)) {
    out.kind = "command_failed";
    out.confidence = 0.55;
    out.hints = [
      "Identify the first real error line (ignore warnings).",
      "Fix the cited file, re-run the same command.",
    ];
  }
  return out;
}

/**
 * Whether a `run` tool observation should trigger fix→re-run classification.
 * Exit code is authoritative; benign stderr (Gtk, warnings) with exit 0 is OK.
 * @param {string} observation
 */
export function observationLooksLikeFailedRun(observation) {
  const s = String(observation || "");
  if (/^POLICY:/im.test(s)) return false;
  if (/^ERROR:/im.test(s)) return true;
  const m = s.match(/^exit (-?\d+)/m);
  if (m && Number(m[1]) !== 0) return true;
  return false;
}

/**
 * True when the user pasted a stack/build log or asked to fix a failure.
 * @param {string} prompt
 */
export function promptLooksLikeErrorDump(prompt) {
  const t = String(prompt || "");
  if (t.length < 40) return false;
  if (
    /\b(fix this|help.*error|build failed|npm err|failed to compile|stack trace|typeerror|cannot find module)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  const signals = [
    /Error:/,
    /TS\d{4}/,
    /at\s+\S+\s+\(/,
    /STDERR:/,
    /Failed to compile/,
    /MODULE_NOT_FOUND/,
    /exit [1-9]/,
  ];
  const hits = signals.filter((re) => re.test(t)).length;
  return hits >= 2 || (hits >= 1 && t.length > 280);
}

/**
 * @param {{ kind: string, hints: string[], suggestedCommands: string[], filesHint: string[] }} c
 */
export function formatClassificationNudge(c) {
  const lines = [
    `ERROR_CLASS: ${c.kind}`,
    ...c.hints.map((h) => `- ${h}`),
  ];
  if (c.kind === "benign_noise") {
    lines.push(
      'Next: do not change code for this. {"done":true} explaining the user should open the URL or use Studio Preview (no xdg-open).',
    );
    return lines.join("\n");
  }
  if (c.filesHint?.length) {
    lines.push(`Likely files: ${c.filesHint.join(", ")}`);
  }
  if (c.suggestedCommands?.length) {
    lines.push(
      `Re-run after fix: ${c.suggestedCommands.map((x) => `\`${x}\``).join(" or ")}`,
    );
  }
  lines.push(
    'Next: read_file the cited path, write_file a minimal fix, run the same failing command, then {"done":true} with what changed.',
  );
  return lines.join("\n");
}
