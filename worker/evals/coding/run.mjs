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
import { toOllamaTools, firstToolCallAction, trimMessagesForContext } from "../../ollama-tools.mjs";
import { extractListenUrls, checkHttpUrl } from "../../http-check.mjs";
import { deriveProjectGoal, rankContinueFiles } from "../../project-goals.mjs";

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

  const deploy = inferGoal("Redeploy to Amplify on customer-workspaces");
  check(
    "goal-deploy",
    deploy.id === "coding" &&
      deploy.hard === true &&
      deploy.playbooks.includes("deploy-amplify.md"),
  );

  const prod = inferGoal(
    "Production WalletConnect offline CredentialProviderError worker 401",
  );
  check(
    "goal-prod-debug",
    prod.id === "coding" &&
      prod.hard === true &&
      prod.playbooks.includes("prod-debug.md"),
  );

  const multi = inferGoal("Refactor this Next.js react app across files");
  check("goal-multi-hard", multi.id === "coding" && multi.hard === true);

  const heading = inferGoal("Change the heading to Hello Continuity");
  check("goal-heading-followup", heading.id === "coding");

  const memory = inferGoal(
    "What did we learn last turn? Summarize open bugs from the checkpoint.",
  );
  check("goal-checkpoint-q", memory.id === "coding");
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
  check(
    "tool-specs",
    /str_replace/.test(spec) &&
      /start_server/.test(spec) &&
      /screenshot_url/.test(spec) &&
      /search_files/.test(spec),
  );
}

{
  const { planLooksComplete, shouldBlockEditWithoutPlan } = await import(
    "../../plan-gate.mjs"
  );
  check(
    "plan-gate-complete",
    planLooksComplete("# Plan\n## Goal\nx\n## Done when\ny\n## Files\n- a.ts\n") ===
      true,
  );
  check(
    "plan-gate-block",
    shouldBlockEditWithoutPlan({
      hard: true,
      wantCdv: false,
      goalId: "coding",
      planPresent: false,
      planComplete: false,
      tool: "write_file",
      path: "src/a.ts",
    }) === true,
  );
}

{
  const { summarizeWorkspaceDiff } = await import("../../diff-summary.mjs");
  const diff = summarizeWorkspaceDiff(
    [{ path: "a.ts", content: "1\n" }],
    [
      { path: "a.ts", content: "2\n" },
      { path: "b.ts", content: "x\n" },
    ],
  );
  check(
    "diff-summary",
    diff.changed.includes("a.ts") && diff.added.includes("b.ts"),
  );
}

{
  const {
    normalizeAgentAction,
    normalizeToolName,
    isCheckpointQuestion,
  } = await import("../../action-normalize.mjs");
  check("tool-name-undef", normalizeToolName("undefined") === null);
  check(
    "tool-repair-write",
    normalizeAgentAction(
      { tool: "undefined", args: {} },
      "write_file path=index.js content=\nconsole.log(1)",
    ).action?.tool === "write_file",
  );
  check(
    "checkpoint-q",
    isCheckpointQuestion("What did we learn last turn from the checkpoint?"),
  );
}

{
  const { mergeLongHorizon, formatCheckpointForPrompt } = await import(
    "../../project-memory.mjs"
  );
  const merged = mergeLongHorizon(
    { decisions: ["keep tests"], verifyFailStreak: 1 },
    { decisions: ["ship PLAN.md"], neverDo: ["xdg-open"], verifyFailStreak: 2 },
  );
  check(
    "long-horizon-merge",
    merged.decisions.includes("keep tests") &&
      merged.decisions.includes("ship PLAN.md") &&
      merged.neverDo.includes("xdg-open"),
  );
  check(
    "long-horizon-format",
    /VERIFY_FAIL_STREAK/.test(
      formatCheckpointForPrompt({ verifyFailStreak: 2, goal: "coding" }),
    ),
  );
}

{
  const tools = toOllamaTools();
  check("ollama-tools-shape", tools[0].type === "function" && tools.some((x) => x.function.name === "check_url"));
  const action = firstToolCallAction([
    { function: { name: "check_url", arguments: { url: "http://127.0.0.1:9/" } } },
  ]);
  check("first-tool-call", action?.tool === "check_url");
  check(
    "trim-messages",
    trimMessagesForContext(
      [
        { role: "system", content: "s" },
        { role: "user", content: "OBSERVATION:\n" + "z".repeat(100000) },
      ],
      { maxChars: 5000 },
    ).length >= 1,
  );
}

{
  check(
    "extract-url",
    extractListenUrls("Server running at http://127.0.0.1:3000/").includes(
      "http://127.0.0.1:3000/",
    ),
  );
  const g = deriveProjectGoal("Ship a Next.js landing page");
  check("project-goal", /Next/i.test(String(g.summary)));
  check(
    "rank-files",
    rankContinueFiles(["a.ts", "package.json"], ["a.ts"])[0] === "a.ts",
  );
}

if (failed) {
  console.error(`\n${failed} coding eval(s) failed`);
  process.exit(1);
}
console.log("\nevals/coding ok");
