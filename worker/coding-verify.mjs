/**
 * Post-turn verify for general coding / web goals (peer of ChiaLisp verify).
 */
import { promises as fs } from "fs";
import path from "path";

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
  if (scripts.test) cmds.push("npm test -- --watchAll=false");
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
