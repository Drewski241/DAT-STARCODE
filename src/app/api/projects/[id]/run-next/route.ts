import { NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { processOneInlineJob } from "@/lib/inline-worker";
import { resolveModel } from "@/lib/models";
import { requireRegisteredAccount } from "@/lib/require-auth";
import {
  buildStepPrompt,
  enqueueJob,
  getAccount,
  getProject,
} from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project || project.accountId !== auth.account.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (project.status === "planning" || project.status === "running") {
    return NextResponse.json(
      { error: "A project job is already in flight" },
      { status: 409 },
    );
  }
  if (!project.steps.length) {
    return NextResponse.json(
      { error: "Project has no steps yet — wait for the plan or add steps" },
      { status: 400 },
    );
  }

  const step = project.steps.find((s) => s.status === "pending");
  if (!step) {
    return NextResponse.json(
      { error: "No pending steps left" },
      { status: 400 },
    );
  }

  const prompt = buildStepPrompt(project, step);
  const resolved = resolveModel(project.modelRequested, prompt);

  try {
    const { job, account } = await enqueueJob({
      accountId: auth.account.id,
      prompt,
      modelRequested: resolved.requested,
      modelResolved: resolved.resolved,
      modelReason: `Project step · ${step.title}`,
      agentProfile: project.agentProfile || resolved.agentProfile,
      kind: "step",
      projectId: project.id,
      stepId: step.id,
    });

    void processOneInlineJob();

    const fresh = await getProject(project.id);
    return NextResponse.json({
      job,
      project: fresh,
      account: toPublicAccount(account),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enqueue failed";
    // refresh account credits for client
    const account = await getAccount(auth.account.id);
    return NextResponse.json(
      {
        error: message,
        account: account ? toPublicAccount(account) : undefined,
      },
      { status: 402 },
    );
  }
}
