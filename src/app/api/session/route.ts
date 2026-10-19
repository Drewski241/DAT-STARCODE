import { NextRequest, NextResponse } from "next/server";
import { getOrCreateAccount, linkWallet } from "@/lib/store";

export async function GET(req: NextRequest) {
  const accountId = req.cookies.get("anvil_account")?.value;
  const account = await getOrCreateAccount(accountId);
  const res = NextResponse.json({ account });
  if (!accountId || accountId !== account.id) {
    res.cookies.set("anvil_account", account.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

export async function PATCH(req: NextRequest) {
  const accountId = req.cookies.get("anvil_account")?.value;
  if (!accountId) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }
  const body = (await req.json()) as { walletAddress?: string };
  if (!body.walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }
  const account = await linkWallet(accountId, body.walletAddress);
  return NextResponse.json({ account });
}
