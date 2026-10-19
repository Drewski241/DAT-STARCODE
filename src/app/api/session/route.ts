import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { readSessionAccountId } from "@/lib/session";
import { getAccount, isRegisteredAccount, linkWallet } from "@/lib/store";

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

export async function PATCH(req: NextRequest) {
  const accountId = await readSessionAccountId();
  if (!accountId) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const account = await getAccount(accountId);
  if (!account || !isRegisteredAccount(account)) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const body = (await req.json()) as { walletAddress?: string };
  if (!body.walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }
  const updated = await linkWallet(accountId, body.walletAddress);
  return NextResponse.json({ account: toPublicAccount(updated) });
}
