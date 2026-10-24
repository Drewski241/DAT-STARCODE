import { NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { skipProjectStep } from "@/lib/store";

type Ctx = { params: Promise<{ id: string; stepId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  const { id, stepId } = await ctx.params;
  try {
    const project = await skipProjectStep(id, auth.account.id, stepId);
    return NextResponse.json({
      project,
      account: toPublicAccount(auth.account),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Skip failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
