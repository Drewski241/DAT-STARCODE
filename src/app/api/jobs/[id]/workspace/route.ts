import { NextRequest, NextResponse } from "next/server";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getJob } from "@/lib/store";
import { listWorkspaceFiles, workspacePrefix } from "@/lib/workspace";

export async function GET(
  _req: NextRequest,
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

  const files = await listWorkspaceFiles(job);
  return NextResponse.json({
    workspaceId: job.workspaceId ?? workspacePrefix(job),
    fileCount: files.length,
    files,
  });
}
