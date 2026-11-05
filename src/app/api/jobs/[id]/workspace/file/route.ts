import { NextRequest, NextResponse } from "next/server";
import { isSafeWorkspacePath, normalizePath } from "@/lib/extract-files";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getJob, listJobsForProject } from "@/lib/store";
import type { CodingJob } from "@/lib/types";
import { readWorkspaceFile, writeWorkspaceFiles } from "@/lib/workspace";

const MAX_SAVE_BYTES = 400_000;

async function projectTurnInFlight(job: CodingJob) {
  const live = (status: string) =>
    status === "queued" || status === "claimed" || status === "running";
  if (live(job.status)) return true;
  if (!job.projectId) return false;
  const jobs = await listJobsForProject(job.projectId);
  return jobs.some((row) => live(row.status));
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (job.accountId !== auth.account.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rel = req.nextUrl.searchParams.get("path");
  if (!rel) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const content = await readWorkspaceFile(job, rel);
  if (content == null) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return NextResponse.json({ path: rel, content });
}

/** Save one text file into the project workspace for the next turn. */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (job.accountId !== auth.account.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    path?: unknown;
    content?: unknown;
  } | null;
  const rel = typeof body?.path === "string" ? body.path : "";
  const content = typeof body?.content === "string" ? body.content : null;
  if (!rel || content == null) {
    return NextResponse.json({ error: "path and content required" }, { status: 400 });
  }
  const normalized = normalizePath(rel);
  if (!isSafeWorkspacePath(normalized)) {
    return NextResponse.json({ error: "That path cannot be saved" }, { status: 400 });
  }
  if (Buffer.byteLength(content, "utf8") > MAX_SAVE_BYTES) {
    return NextResponse.json(
      { error: "File is too large to save from Studio" },
      { status: 413 },
    );
  }
  if (await projectTurnInFlight(job)) {
    return NextResponse.json(
      {
        error:
          "A turn is still running in this project. Save after it finishes so the agent does not overwrite your edit.",
      },
      { status: 409 },
    );
  }

  const written = await writeWorkspaceFiles(job, [
    { path: normalized, content },
  ]);
  if (written.length === 0) {
    return NextResponse.json({ error: "That path cannot be saved" }, { status: 400 });
  }
  return NextResponse.json({ path: written[0].path, size: written[0].size });
}
