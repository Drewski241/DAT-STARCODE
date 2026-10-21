import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { buildContinueContext } from "@/lib/job-context";
import { resolveModel } from "@/lib/models";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { enqueueJob, listJobs, setJobWorkspaceFileCount } from "@/lib/store";
import {
  copyWorkspaceFromJob,
  initWorkspace,
  listWorkspaceFiles,
} from "@/lib/workspace";

export async function GET() {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  const jobs = await listJobs(auth.account.id);
  return NextResponse.json({
    account: toPublicAccount(auth.account),
    jobs,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const body = (await req.json()) as {
    prompt?: string;
    repoHint?: string;
    model?: string;
    continueFromJobId?: string | null;
  };

  if (!body.prompt || body.prompt.trim().length < 8) {
    return NextResponse.json(
      { error: "Prompt must be at least 8 characters" },
      { status: 400 },
    );
  }

  const resolved = resolveModel(body.model, body.prompt);

  let parentJobId: string | null = null;
  let context: string | null = null;
  if (body.continueFromJobId?.trim()) {
    const built = await buildContinueContext(
      body.continueFromJobId.trim(),
      auth.account.id,
    );
    if (built) {
      parentJobId = built.parent.id;
      context = built.context;
    }
  }

  try {
    const result = await enqueueJob({
      accountId: auth.account.id,
      prompt: body.prompt,
      repoHint: body.repoHint,
      parentJobId,
      context,
      modelRequested: resolved.requested,
      modelResolved: resolved.resolved,
      modelReason: resolved.reason,
      accountSeed: auth.account,
    });

    await initWorkspace(result.job);
    if (parentJobId) {
      const parent = await buildContinueContext(parentJobId, auth.account.id);
      if (parent) {
        await copyWorkspaceFromJob(parent.parent, result.job);
      }
    }
    const seeded = await listWorkspaceFiles(result.job);
    const job =
      seeded.length > 0
        ? await setJobWorkspaceFileCount(result.job.id, seeded.length)
        : result.job;

    return NextResponse.json({
      job,
      account: toPublicAccount(result.account),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enqueue failed";
    return NextResponse.json({ error: message }, { status: 402 });
  }
}
