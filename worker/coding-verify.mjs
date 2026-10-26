/**
 * Post-turn verify for general coding / web goals (peer of ChiaLisp verify).
 */
import { promises as fs } from "fs";
import path from "path";

/**
 * Jest/CRA watch-mode needs --watchAll=false; plain node/python scripts must not
 * receive that flag (node -e "…" → "bad option: --watchAll=false").
 * @param {string} script
 */
export function testCommandForScript(script) {
  const s = String(script || "");
  const needsWatchOff =
    /\b(react-scripts|cra)\b/i.test(s) ||
    /\bjest\b/i.test(s) ||
    /\bvitest\b/i.test(s) ||
    /\b--watch\b/i.test(s);
  if (needsWatchOff) return "npm test -- --watchAll=false";
  return "npm test";
}

/**
 * @param {unknown} pkg
 * @returns {string[]}
 */
export function pickVerifyCommands(pkg) {
  const scripts =
    pkg && typeof pkg === "object" && pkg !== null && "scripts" in pkg
      ? /** @type {Record<string, string>} */ (pkg.scripts || {})
      : {};
  /** @type {string[]} */
  const cmds = [];
  // Prefer fast correctness gates first.
  if (scripts.test) cmds.push(testCommandForScript(String(scripts.test)));
  else if (scripts["test:ci"]) cmds.push("npm run test:ci");
  else if (scripts["test:unit"]) cmds.push("npm run test:unit");

  if (scripts["typecheck"]) cmds.push("npm run typecheck");
  else if (scripts["type-check"]) cmds.push("npm run type-check");

  if (scripts.build) cmds.push("npm run build");
  else if (scripts["build:check"]) cmds.push("npm run build:check");

  if (scripts.lint && cmds.length === 0) cmds.push("npm run lint");

  // Dedupe while preserving order
  return [...new Set(cmds)].slice(0, 2);
}

/**
 * @param {string} root
 * @returns {Promise<{ hasPackage: boolean, commands: string[], packageName?: string }>}
 */
export async function planCodingVerify(root) {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    return {
      hasPackage: true,
      commands: pickVerifyCommands(pkg),
      packageName: typeof pkg.name === "string" ? pkg.name : undefined,
    };
  } catch {
    return { hasPackage: false, commands: [] };
  }
}

/**
 * Heuristic: workspace looks like a JS/web project worth verifying.
 * @param {{ path: string }[]} files
 */
export function codingWorkspaceWorthVerify(files) {
  const paths = (files || []).map((f) => String(f.path || ""));
  if (paths.some((p) => /^package\.json$/i.test(p))) return true;
  if (
    paths.some((p) =>
      /^(src\/|app\/|pages\/|components\/).+\.(tsx?|jsx?)$/i.test(p),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} observation
 */
export function verifyObservationOk(observation) {
  const s = String(observation || "");
  if (/^ERROR:/im.test(s) || /^POLICY:/im.test(s)) return false;
  const m = s.match(/^exit (-?\d+)/m);
  if (m && Number(m[1]) !== 0) return false;
  return true;
}

/**
 * User asked for a failing test on purpose (capability / demo) — do not treat
 * verify fail as a bug to escalate or "fix next turn".
 * @param {string} prompt
 */
export function isIntentionalVerifyFail(prompt) {
  const p = String(prompt || "");
  return (
    /\b(do not change the test to pass|leave (the )?test failing|intentional(ly)? fail|process\.exit\(1\)|scripts\.test is exactly)\b/i.test(
      p,
    ) && /\b(test|npm test|scripts\.test|process\.exit)\b/i.test(p)
  );
}

/** Canonical scripts.test for Studio capability #7. */
export const INTENTIONAL_FAIL_TEST_SCRIPT = 'node -e "process.exit(1)"';

/**
 * Force scripts.test to the intentional fail command; never leave exit(1) on
 * scripts.dev (live zip f4fc292f put the fail on "dev" and skipped verify).
 * @param {unknown} pkg
 * @returns {{ pkg: Record<string, unknown>, changed: boolean, message: string }}
 */
export function enforceIntentionalFailScripts(pkg) {
  const base =
    pkg && typeof pkg === "object" && !Array.isArray(pkg)
      ? /** @type {Record<string, unknown>} */ ({ ...pkg })
      : { name: "workspace", version: "1.0.0", private: true };
  const scripts =
    base.scripts && typeof base.scripts === "object" && !Array.isArray(base.scripts)
      ? /** @type {Record<string, unknown>} */ ({ ...base.scripts })
      : {};
  let changed = false;
  const want = INTENTIONAL_FAIL_TEST_SCRIPT;
  if (scripts.test !== want) {
    scripts.test = want;
    changed = true;
  }
  // Undo mistaken "put exit(1) on dev" — restore a normal http-server when needed.
  if (
    typeof scripts.dev === "string" &&
    /process\.exit\(1\)/i.test(scripts.dev)
  ) {
    scripts.dev = "http-server";
    changed = true;
  }
  if (!scripts.dev) {
    scripts.dev = "http-server";
    changed = true;
  }
  base.scripts = scripts;
  return {
    pkg: base,
    changed,
    message: changed
      ? `Enforced scripts.test=${JSON.stringify(want)} (dev kept as ${JSON.stringify(scripts.dev)})`
      : "scripts.test already intentional-fail",
  };
}

/**
 * Read/repair package.json on disk for intentional-fail demos.
 * @param {string} root
 * @param {{ readFile?: typeof fs.readFile, writeFile?: typeof fs.writeFile }} [io]
 */
export async function ensureIntentionalFailPackageJson(root, io = {}) {
  const readFile = io.readFile || fs.readFile.bind(fs);
  const writeFile = io.writeFile || fs.writeFile.bind(fs);
  const pkgPath = path.join(root, "package.json");
  let raw = "{}";
  try {
    raw = await readFile(pkgPath, "utf8");
  } catch {
    raw = "{}";
  }
  let parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const { pkg, changed, message } = enforceIntentionalFailScripts(parsed);
  if (changed) {
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }
  return { changed, message, pkg };
}

export const INTENTIONAL_FAIL_INDEX_JS = 'console.log("ok");\n';

/**
 * Capability #7 deliverables: package.json scripts.test + index.js console.log("ok").
 * Deterministic — do not rely on 7B to leave both files in the workspace
 * (live zip 3b520e35 had neither after the turn).
 * @param {string} root
 */
export async function ensureIntentionalFailDeliverables(root) {
  /** @type {string[]} */
  const notes = [];
  const pkgFix = await ensureIntentionalFailPackageJson(root);
  if (pkgFix.changed) notes.push(pkgFix.message);
  const indexPath = path.join(root, "index.js");
  let indexBody = "";
  try {
    indexBody = await fs.readFile(indexPath, "utf8");
  } catch {
    indexBody = "";
  }
  const ok =
    /^\s*console\.log\s*\(\s*["']ok["']\s*\)\s*;?\s*$/m.test(indexBody) ||
    /console\.log\s*\(\s*["']ok["']\s*\)/.test(indexBody);
  if (!ok) {
    await fs.writeFile(indexPath, INTENTIONAL_FAIL_INDEX_JS, "utf8");
    notes.push('Wrote index.js with console.log("ok")');
  }
  return {
    changed: notes.length > 0,
    notes,
    pkg: pkgFix.pkg,
  };
}
