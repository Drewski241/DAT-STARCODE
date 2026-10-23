import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { buildContinueContext } from "@/lib/job-context";
import { priceJob } from "@/lib/job-pricing";
import { resolveModel } from "@/lib/models";
import { requireRegisteredAccount } from "@/lib/require-auth";
import {
  getProject,
  enqueueJob,
  listJobs,
  listJobsForProject,
  setJobWorkspaceFileCount,
} from "@/lib/store";
import { initWorkspace, listWorkspaceFiles } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  const projectId = req.nextUrl.searchParams.get("projectId");
  const jobs = projectId
    ? await listJobsForProject(projectId)
    : await listJobs(auth.account.id);
  if (projectId) {
    const project = await getProject(projectId);
    if (!project || project.accountId !== auth.account.id) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  }
  return NextResponse.json({
    account: toPublicAccount(auth.account),
    jobs,
  });
}

/** Quote credits for a prompt + model without enqueueing. */
export async function PUT(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    model?: string;
  };
  const prompt = body.prompt?.trim() || "";
  const resolved = resolveModel(body.model, prompt || "code");
  const pricing = priceJob({
    prompt: prompt || "code task",
    modelId: resolved.resolved,
  });
  return NextResponse.json({
    account: toPublicAccount(auth.account),
    pricing,
    model: resolved,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const body = (await req.json()) as {
    prompt?: string;
    repoHint?: string;
    model?: string;
    projectId?: string | null;
    continueFromJobId?: string | null;
  };

  if (!body.prompt || body.prompt.trim().length < 8) {
    return NextResponse.json(
      { error: "Prompt must be at least 8 characters" },
      { status: 400 },
    );
  }

  let projectId = body.projectId?.trim() || null;
  if (projectId) {
    const project = await getProject(projectId);
    if (!project || project.accountId !== auth.account.id) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
  }

  const resolved = resolveModel(body.model, body.prompt);

  let parentJobId: string | null = null;
  let context: string | null = null;

  // Prefer explicit continue; otherwise last completed turn in the project.
  const continueId = body.continueFromJobId?.trim() || null;
  if (continueId) {
    const built = await buildContinueContext(continueId, auth.account.id);
    if (built) {
      parentJobId = built.parent.id;
      context = built.context;
      if (!projectId && built.parent.projectId) {
        projectId = built.parent.projectId;
      }
    }
  } else if (projectId) {
    const prior = await listJobsForProject(projectId);
    const lastDone = [...prior].reverse().find((j) => j.status === "completed");
    if (lastDone) {
      const built = await buildContinueContext(lastDone.id, auth.account.id);
      if (built) {
        parentJobId = built.parent.id;
        context = built.context;
      }
    }
  }

  try {
    const result = await enqueueJob({
      accountId: auth.account.id,
      prompt: body.prompt,
      repoHint: body.repoHint,
      projectId,
      parentJobId,
      context,
      modelRequested: resolved.requested,
      modelResolved: resolved.resolved,
      modelReason: resolved.reason,
      accountSeed: auth.account,
    });

    await initWorkspace(result.job);
    const seeded = await listWorkspaceFiles(result.job);
    const job =
      seeded.length > 0
        ? await setJobWorkspaceFileCount(result.job.id, seeded.length)
        : result.job;

    const pricing = priceJob({
      prompt: body.prompt,
      modelId: resolved.resolved,
    });
    return NextResponse.json({
      job,
      account: toPublicAccount(result.account),
      pricing,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enqueue failed";
    return NextResponse.json({ error: message }, { status: 402 });
  }
}
