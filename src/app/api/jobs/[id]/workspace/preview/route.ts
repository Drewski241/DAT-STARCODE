import { NextRequest, NextResponse } from "next/server";
import { bundleHtmlPreview } from "@/lib/html-preview";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getJob } from "@/lib/store";
import { readWorkspaceFile } from "@/lib/workspace";

/** HTML page with same-project CSS and JS inlined for the Studio iframe. */
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

  const rel = req.nextUrl.searchParams.get("path") || "index.html";
  const html = await bundleHtmlPreview(rel, (filePath) =>
    readWorkspaceFile(job, filePath),
  );
  if (html == null) {
    return NextResponse.json({ error: "HTML file not found" }, { status: 404 });
  }

  return NextResponse.json({ path: rel, html });
}
