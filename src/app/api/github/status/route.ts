import { NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { githubConfigured } from "@/lib/github";
import { requireRegisteredAccount } from "@/lib/require-auth";

export async function GET() {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  return NextResponse.json({
    configured: githubConfigured(),
    account: toPublicAccount(auth.account),
  });
}
