/**
 * Rust and Rue deliverable checks.
 * Static traps always fail the turn. Compilers run only when already installed.
 * Rue is not vendored: https://github.com/rue-language/rue (Buck2, scripts/rue-bin).
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const PY_DEF = /(^|\n)\s*def\s+[A-Za-z_]/;
const JS_FUNCTION = /(^|\n)\s*function\s+[A-Za-z_]/;
const GO_PACKAGE_MAIN = /(^|\n)\s*package\s+main\b/;
const HAS_FN = /\bfn\b/;
const RUE_PRINTLN_MACRO = /\bprintln!\s*\(/;
const RUE_IMPL = /(^|[^A-Za-z0-9_])impl\s+[A-Za-z_]/;
const RUE_LIFETIME = /<'[A-Za-z]/;

/**
 * @param {string} rel
 */
export function shQuote(rel) {
  return `'${String(rel).replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string} source
 */
export function rueMainMissingReturn(source) {
  const re = /\bfn\s+main\s*\([^)]*\)([\s\S]*?)\{/g;
  let missing = false;
  let saw = false;
  let m;
  while ((m = re.exec(String(source || "")))) {
    saw = true;
    if (!/->/.test(m[1])) missing = true;
  }
  return saw && missing;
}

/**
 * @param {{ path: string, content: string }} file
 * @returns {string[]}
 */
export function rustFileFailures(file) {
  const body = String(file.content || "");
  const failures = [];
  if (!HAS_FN.test(body)) {
    failures.push(`${file.path}: Rust file has no fn — this is not Rust`);
  }
  if (PY_DEF.test(body)) {
    failures.push(`${file.path}: Python \`def\` is not Rust`);
  }
  if (JS_FUNCTION.test(body)) {
    failures.push(`${file.path}: JavaScript \`function\` is not Rust`);
  }
  if (GO_PACKAGE_MAIN.test(body)) {
    failures.push(`${file.path}: Go \`package main\` is not Rust`);
  }
  return failures;
}

/**
 * @param {{ path: string, content: string }} file
 * @returns {string[]}
 */
export function rueFileFailures(file) {
  const body = String(file.content || "");
  const failures = [];
  if (!HAS_FN.test(body)) {
    failures.push(`${file.path}: Rue file has no fn — this is not Rue`);
  }
  if (RUE_PRINTLN_MACRO.test(body)) {
    failures.push(
      `${file.path}: \`println!\` is Rust — Rue calls \`println("...")\``,
    );
  }
  if (RUE_IMPL.test(body)) {
    failures.push(
      `${file.path}: Rue has no impl blocks — methods live on the struct`,
    );
  }
  if (RUE_LIFETIME.test(body)) {
    failures.push(`${file.path}: Rust lifetimes (\`'a\`) are not Rue`);
  }
  if (PY_DEF.test(body)) {
    failures.push(`${file.path}: Python \`def\` is not Rue`);
  }
  if (rueMainMissingReturn(body)) {
    failures.push(
      `${file.path}: \`fn main\` must return a status (\`fn main() -> i32\`)`,
    );
  }
  return failures;
}

/**
 * @param {{ path: string, content: string }[]} files
 * @param {{ langs?: string[] }} [opts]
 * @returns {{ ok: boolean, failures: string[], warnings: string[] }}
 */
export function verifyLanguageDeliverables(files, opts = {}) {
  const langs = new Set(opts.langs || []);
  const failures = [];
  const list = Array.isArray(files) ? files : [];
  const rs = list.filter(
    (f) => /\.rs$/i.test(f.path) && !/(^|\/)target\//i.test(f.path),
  );
  const rue = list.filter((f) => /\.rue$/i.test(f.path));

  if (langs.has("rust") && rs.length === 0) {
    failures.push(
      "Rust goal expected a `.rs` deliverable, but none was written.",
    );
  }
  if (langs.has("rue") && rue.length === 0) {
    failures.push(
      "Rue goal expected a `.rue` deliverable, but none was written.",
    );
  }
  for (const f of rs) failures.push(...rustFileFailures(f));
  for (const f of rue) failures.push(...rueFileFailures(f));
  return { ok: failures.length === 0, failures, warnings: [] };
}

/**
 * @param {string} bin
 * @returns {Promise<string>}
 */
function defaultLookPath(bin) {
  return new Promise((resolve) => {
    const child = spawn("which", [bin], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.on("error", () => resolve(""));
    child.on("close", (code) => {
      resolve(code === 0 ? out.trim().split("\n")[0] : "");
    });
  });
}

/**
 * Prefer src/lib.rs, then src/main.rs, then a root main.rs, else every loose .rs file.
 * @param {{ path: string, content: string }[]} files
 */
export function pickRustcTargets(files) {
  const rs = (files || []).filter(
    (f) => /\.rs$/i.test(f.path) && !/(^|\/)target\//i.test(f.path),
  );
  const lib = rs.find((f) => /(^|\/)src\/lib\.rs$/i.test(f.path));
  if (lib) return [{ path: lib.path, crateType: "lib" }];
  const srcMain = rs.find((f) => /(^|\/)src\/main\.rs$/i.test(f.path));
  if (srcMain) return [{ path: srcMain.path, crateType: "bin" }];
  const rootMain = rs.find((f) => /(^|\/)main\.rs$/i.test(f.path));
  if (rootMain) return [{ path: rootMain.path, crateType: "bin" }];
  return rs.map((f) => ({
    path: f.path,
    crateType: /\bfn\s+main\s*\(/.test(String(f.content || "")) ? "bin" : "lib",
  }));
}

/**
 * @param {string} root
 * @param {{
 *   langs?: string[],
 *   files?: { path: string, content: string }[],
 *   lookPath?: (bin: string) => Promise<string>,
 *   env?: NodeJS.ProcessEnv,
 *   hasCargoToml?: boolean,
 *   rustcOutDir?: string,
 *   rueOutPath?: string,
 * }} [opts]
 * @returns {Promise<{ commands: string[], warnings: string[] }>}
 */
export async function planLanguageCompile(root, opts = {}) {
  const langs = new Set(opts.langs || []);
  const lookPath = opts.lookPath || defaultLookPath;
  const env = opts.env || process.env;
  const files = opts.files || [];
  /** @type {string[]} */
  const commands = [];
  /** @type {string[]} */
  const warnings = [];

  if (langs.has("rust")) {
    let hasCargoToml = opts.hasCargoToml;
    if (hasCargoToml == null) {
      try {
        await fs.access(path.join(root, "Cargo.toml"));
        hasCargoToml = true;
      } catch {
        hasCargoToml = false;
      }
    }
    const cargo = hasCargoToml ? await lookPath("cargo") : "";
    if (hasCargoToml && cargo) {
      commands.push("cargo check");
    } else {
      const rustc = await lookPath("rustc");
      if (rustc) {
        const targets = pickRustcTargets(files);
        if (targets.length) {
          const out =
            opts.rustcOutDir || path.join(os.tmpdir(), "datstarcoder-rustc");
          await fs.mkdir(out, { recursive: true });
          for (const t of targets) {
            commands.push(
              `rustc --edition 2021 --emit=metadata --crate-type ${t.crateType} --out-dir ${shQuote(out)} ${shQuote(t.path)}`,
            );
          }
        }
        if (hasCargoToml && !cargo) {
          warnings.push(
            "Cargo.toml is present but cargo is not on PATH. Checked with rustc instead.",
          );
        }
      } else {
        warnings.push(
          "Rust toolchain not found (cargo/rustc). Static checks ran. Install rustup on the worker to compile. This is a warning, not a failed turn.",
        );
      }
    }
  }

  if (langs.has("rue")) {
    const rueFiles = files.filter((f) => /\.rue$/i.test(f.path));
    const fromEnv = String(env.RUE_BIN || "").trim();
    let rueBin = "";
    if (fromEnv) {
      try {
        await fs.access(fromEnv);
        rueBin = fromEnv;
      } catch {
        warnings.push(
          `RUE_BIN is set (${fromEnv}) but that file is missing. Static Rue checks still ran.`,
        );
      }
    } else {
      rueBin = await lookPath("rue");
    }
    if (rueBin && rueFiles.length) {
      const out =
        opts.rueOutPath ||
        path.join(os.tmpdir(), `datstarcoder-rue-${process.pid}`);
      commands.push(
        `${shQuote(rueBin)} ${rueFiles.map((f) => shQuote(f.path)).join(" ")} -o ${shQuote(out)}`,
      );
    } else if (!rueBin) {
      warnings.push(
        "Rue compiler not found (PATH `rue` or RUE_BIN). Static checks ran. The compiler is scripts/rue-bin in github.com/rue-language/rue (Buck2). It is not downloaded by the worker.",
      );
    }
  }

  return { commands, warnings };
}
