import { ACCOUNT_COOKIE } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/store";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const accountId = req.cookies.get(ACCOUNT_COOKIE)?.value;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (accountId && job.accountId !== accountId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ job });
}
