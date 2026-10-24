import { NextRequest, NextResponse } from "next/server";
import { getWorkerApiKey } from "@/lib/config";
import { completeJob, getJob } from "@/lib/store";
import { materializeWorkspaceFromResult } from "@/lib/workspace";
import type { ExtractedFile } from "@/lib/extract-files";
import type { CodingJob } from "@/lib/types";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-worker-key")?.trim();
  if (!key || key !== getWorkerApiKey()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    jobId?: string;
    workerId?: string;
    result?: string;
    error?: string;
    files?: ExtractedFile[];
    toolSteps?: number;
    githubBranch?: string | null;
    githubPrUrl?: string | null;
    stepsUsed?: number | null;
    snapshot?: CodingJob | null;
  };

  if (!body.jobId || !body.workerId) {
    return NextResponse.json(
      { error: "jobId and workerId required" },
      { status: 400 },
    );
  }

  try {
    let workspaceFileCount: number | undefined;
    if (!body.error && body.result) {
      const existing =
        (await getJob(body.jobId)) ??
        (body.snapshot ? body.snapshot : null);
      if (existing) {
        const materialized = await materializeWorkspaceFromResult(
          existing,
          body.result,
          body.files,
        );
        workspaceFileCount = materialized.count;
      }
    }

    const job = await completeJob({
      jobId: body.jobId,
      workerId: body.workerId,
      result: body.result,
      error: body.error,
      workspaceFileCount,
      toolSteps: body.toolSteps,
      githubBranch: body.githubBranch,
      githubPrUrl: body.githubPrUrl,
      stepsUsed: body.stepsUsed,
      snapshot: body.snapshot,
    });
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Complete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
