import { NextRequest, NextResponse } from "next/server";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getJob } from "@/lib/store";
import { readWorkspaceFile } from "@/lib/workspace";

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
