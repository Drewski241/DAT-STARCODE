import { NextRequest, NextResponse } from "next/server";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getJob } from "@/lib/store";
import { buildWorkspaceZip, listWorkspaceFiles } from "@/lib/workspace";

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
  if (files.length === 0) {
    return NextResponse.json(
      { error: "Workspace is empty" },
      { status: 404 },
    );
  }

  const zip = await buildWorkspaceZip(job);
  const filename = `starcoder-${job.id.slice(0, 8)}.zip`;
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
