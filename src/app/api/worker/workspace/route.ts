import { NextRequest, NextResponse } from "next/server";
import { getWorkerApiKey } from "@/lib/config";
import { getJob } from "@/lib/store";
import {
  deleteWorkspaceFiles,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFiles,
} from "@/lib/workspace";

function authorize(req: NextRequest) {
  const key = req.headers.get("x-worker-key")?.trim();
  return Boolean(key && key === getWorkerApiKey());
}

/** Pull all workspace files for a claimed job (agent loop). */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    jobId?: string;
    workerId?: string;
    action?: "pull" | "push";
    files?: { path: string; content: string }[];
    /** Paths removed on the worker that should be dropped from Studio/S3. */
    deletePaths?: string[];
  };

  if (!body.jobId || !body.workerId) {
    return NextResponse.json(
      { error: "jobId and workerId required" },
      { status: 400 },
    );
  }

  const job = await getJob(body.jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.workerId && job.workerId !== body.workerId) {
    return NextResponse.json({ error: "Worker mismatch" }, { status: 403 });
  }

  const action = body.action ?? "pull";
  if (action === "push") {
    const written = await writeWorkspaceFiles(job, body.files ?? []);
    const deleted = await deleteWorkspaceFiles(job, body.deletePaths ?? []);
    return NextResponse.json({
      ok: true,
      written: written.length,
      deleted: deleted.length,
      deletedPaths: deleted,
    });
  }

  const listed = await listWorkspaceFiles(job);
  const files: { path: string; content: string }[] = [];
  for (const info of listed) {
    const content = await readWorkspaceFile(job, info.path);
    if (content == null) continue;
    files.push({ path: info.path, content });
  }
  return NextResponse.json({
    jobId: job.id,
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    files,
  });
}
