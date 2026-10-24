import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getProject, updateProjectSteps } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project || project.accountId !== auth.account.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    account: toPublicAccount(auth.account),
    project,
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    steps?: { id?: string; title: string; prompt: string }[];
  };
  if (!body.steps || !Array.isArray(body.steps)) {
    return NextResponse.json({ error: "steps required" }, { status: 400 });
  }
  try {
    const project = await updateProjectSteps(id, auth.account.id, body.steps);
    return NextResponse.json({
      account: toPublicAccount(auth.account),
      project,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
