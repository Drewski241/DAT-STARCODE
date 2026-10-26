#!/usr/bin/env node
/**
 * Offline coding-capability evals (no Ollama required).
 * Run: node worker/evals/coding/run.mjs
 */
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { applyStrReplace } from "../../str-replace.mjs";
import {
  pickVerifyCommands,
  codingWorkspaceWorthVerify,
  planCodingVerify,
  verifyObservationOk,
} from "../../coding-verify.mjs";
import {
  isAllowedServerCommand,
  startBackground,
  serverLogs,
  stopBackground,
} from "../../process-supervisor.mjs";
import { inferGoal } from "../../goals.mjs";
import { classifyErrorLog } from "../../error-classify.mjs";
import { formatToolSpecsForPrompt } from "../../tool-specs.mjs";

let failed = 0;
function check(id, cond, detail = "") {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${id}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`ok   ${id}`);
  }
}

// Goal routing: website vs Gtk fix-this
{
  const web = inferGoal("Build a small website");
  check("goal-website", web.id === "coding" && web.hard === false && web.wantCdv === false);

  const gtk = inferGoal(
    `Fix this error\n\nexit 0\nSTDERR:\nGtk-Message: atk-bridge\n`,
  );
  check("goal-gtk-benign", gtk.hard === false && gtk.wantCdv === false);

  const ts = inferGoal(
    "Fix this\n\nsrc/a.ts(1,1): error TS2322: Type 'string' is not assignable",
  );
  check("goal-ts-hard", ts.hard === true && ts.wantCdv === false);
}

// str_replace uniqueness
{
  const r = applyStrReplace("foo bar foo", {
    oldText: "foo",
    newText: "baz",
  });
  check("str-replace-multi-reject", r.ok === false);

  const ok = applyStrReplace("const x = 1;\n", {
    oldText: "const x = 1;",
    newText: "const x = 2;",
  });
  check("str-replace-ok", ok.ok === true && ok.content.includes("const x = 2;"));
}

// verify planning
{
  check(
    "verify-pick",
    pickVerifyCommands({ scripts: { test: "vitest", build: "next build" } })
      .length === 2,
  );
  check(
    "verify-worth",
    codingWorkspaceWorthVerify([{ path: "package.json" }]) === true,
  );
  check("verify-exit0", verifyObservationOk("exit 0\n"));
  check("verify-exit1", verifyObservationOk("exit 1\nfail") === false);
}

// server allowlist + live smoke
{
  check("server-allow-dev", isAllowedServerCommand("npm run dev") === true);
  check("server-deny-xdg", isAllowedServerCommand("xdg-open http://x") === false);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-eval-"));
  await fs.writeFile(
    path.join(root, "server.js"),
    `require('http').createServer((q,s)=>s.end('ok')).listen(0,'127.0.0.1',function(){console.log('READY '+this.address().port);});\n`,
    "utf8",
  );
  const started = await startBackground(root, {
    name: "eval",
    command: "node server.js",
  });
  check("server-start", started.ok === true, started.message);
  const logs = await serverLogs(root, { name: "eval" });
  check("server-logs", /READY/i.test(String(logs.logTail || "")), logs.logTail);
  await stopBackground(root, "eval");
}

// package plan from disk
{
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsc-pkg-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "demo", scripts: { build: "echo ok" } }),
    "utf8",
  );
  const plan = await planCodingVerify(root);
  check(
    "plan-coding-verify",
    plan.hasPackage && plan.commands.includes("npm run build"),
  );
}

// classifier + tool specs surface
{
  check(
    "benign-gtk",
    classifyErrorLog("exit 0\nSTDERR:\nGtk-Message: atk-bridge").kind ===
      "benign_noise",
  );
  const spec = formatToolSpecsForPrompt();
  check("tool-specs", /str_replace/.test(spec) && /start_server/.test(spec));
}

if (failed) {
  console.error(`\n${failed} coding eval(s) failed`);
  process.exit(1);
}
console.log("\nevals/coding ok");
