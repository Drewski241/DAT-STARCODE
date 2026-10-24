import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import {
  attachSession,
  createSessionToken,
  readSessionAccountId,
} from "@/lib/session";
import {
  getAccount,
  isRegisteredAccount,
  linkWallet,
  reconcileAccountCredits,
  unlinkWallet,
} from "@/lib/store";

export async function GET() {
  const accountId = await readSessionAccountId();
  if (!accountId) {
    return NextResponse.json({ account: null });
  }
  let account = await getAccount(accountId);
  if (!account || !isRegisteredAccount(account)) {
    return NextResponse.json({ account: null });
  }

  // Rebuild balance from payments − jobs when the row drifted (redeploy races).
  try {
    const reconciled = await reconcileAccountCredits(accountId);
    if (reconciled) account = reconciled;
  } catch {
    // keep last known account row
  }

  const token = await createSessionToken({
    accountId: account.id,
    username: account.username,
    credits: account.credits,
  });
  const res = NextResponse.json({ account: toPublicAccount(account) });
  return attachSession(res, token, account.id);
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
  const body = (await req.json()) as {
    walletAddress?: string | null;
    unlinkWallet?: boolean;
  };

  if (body.unlinkWallet === true || body.walletAddress === null) {
    const updated = await unlinkWallet(accountId);
    return NextResponse.json({ account: toPublicAccount(updated) });
  }

  if (!body.walletAddress || typeof body.walletAddress !== "string") {
    return NextResponse.json(
      { error: "walletAddress required (or unlinkWallet: true)" },
      { status: 400 },
    );
  }
  const updated = await linkWallet(accountId, body.walletAddress);
  return NextResponse.json({ account: toPublicAccount(updated) });
}
