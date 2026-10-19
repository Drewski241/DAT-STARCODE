import { NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { readSessionAccountId } from "@/lib/session";
import { getAccount, isRegisteredAccount } from "@/lib/store";

export async function GET() {
  const accountId = await readSessionAccountId();
  if (!accountId) {
    return NextResponse.json({ account: null });
  }
  const account = await getAccount(accountId);
  if (!account || !isRegisteredAccount(account)) {
    return NextResponse.json({ account: null });
  }
  return NextResponse.json({ account: toPublicAccount(account) });
}
