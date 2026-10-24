import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { CREDITS_PER_JOB } from "@/lib/config";
import { processOneInlineJob } from "@/lib/inline-worker";
import { resolveModel } from "@/lib/models";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { createProject, enqueueJob, listProjects } from "@/lib/store";

/** Plan jobs are cheaper — checklist only. */
const PLAN_CREDITS = Math.max(1, Math.floor(CREDITS_PER_JOB / 2));

export async function GET() {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  const projects = await listProjects(auth.account.id);
  return NextResponse.json({
    account: toPublicAccount(auth.account),
    projects,
    planCredits: PLAN_CREDITS,
    stepCredits: CREDITS_PER_JOB,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const body = (await req.json()) as {
    goal?: string;
    model?: string;
    title?: string;
  };

  if (!body.goal || body.goal.trim().length < 12) {
    return NextResponse.json(
      { error: "Project goal must be at least 12 characters" },
      { status: 400 },
    );
  }

  const resolved = resolveModel(body.model, body.goal);
  const { project } = await createProject({
    accountId: auth.account.id,
    goal: body.goal,
    title: body.title,
    modelRequested: resolved.requested,
    agentProfile: resolved.agentProfile,
  });

  const planPrompt = [
    "Break this goal into a short checklist of concrete steps for DAT STARCODER.",
    "Each step must be small enough for one worker job.",
    "Return a brief human-readable plan in markdown, THEN a machine block exactly like:",
    "<!--PLAN_JSON",
    '{"title":"Short project title","steps":[{"title":"...","prompt":"detailed instructions for the agent"}]}',
    "PLAN_JSON-->",
    "Use 3–8 steps. prompts should be actionable and self-contained.",
    "",
    `Goal:\n${body.goal.trim()}`,
  ].join("\n");

  try {
    const { job, account } = await enqueueJob({
      accountId: auth.account.id,
      prompt: planPrompt,
      modelRequested: resolved.requested,
      modelResolved: resolved.resolved,
      modelReason: `Project plan · ${resolved.reason}`,
      agentProfile: resolved.agentProfile,
      kind: "plan",
      projectId: project.id,
      creditCost: PLAN_CREDITS,
    });

    // Demo convenience: process the plan in-process when no live worker.
    void processOneInlineJob();

    return NextResponse.json({
      project: { ...project, status: "planning", planJobId: job.id },
      job,
      account: toPublicAccount(account),
      planCredits: PLAN_CREDITS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Plan enqueue failed";
    return NextResponse.json({ error: message }, { status: 402 });
  }
}
