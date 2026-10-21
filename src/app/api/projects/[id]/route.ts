import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getProject, listJobsForProject } from "@/lib/store";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project || project.accountId !== auth.account.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const jobs = await listJobsForProject(id);
  return NextResponse.json({
    account: toPublicAccount(auth.account),
    project,
    jobs,
  });
}
