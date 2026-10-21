import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { createProject, listProjects } from "@/lib/store";

export async function GET() {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  const projects = await listProjects(auth.account.id);
  return NextResponse.json({
    account: toPublicAccount(auth.account),
    projects,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const project = await createProject({
    accountId: auth.account.id,
    title: body.title,
    accountSeed: auth.account,
  });
  return NextResponse.json({
    account: toPublicAccount(auth.account),
    project,
  });
}
