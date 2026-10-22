import { NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { clearGithubConnection } from "@/lib/store";

export async function POST() {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;
  const account = await clearGithubConnection(auth.account.id);
  return NextResponse.json({ account: toPublicAccount(account) });
}
