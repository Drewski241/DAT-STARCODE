import { NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { readSession } from "@/lib/session";
import { getAccount, isRegisteredAccount } from "@/lib/store";
import type { Account } from "@/lib/types";

export async function GET() {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ account: null });
  }

  let account = await getAccount(session.accountId);
  if (!account || !isRegisteredAccount(account)) {
    if (session.username) {
      const now = new Date().toISOString();
      account = {
        id: session.accountId,
        username: session.username,
        email: null,
        passwordHash: null,
        pokerPlayerId: null,
        source: "local",
        walletAddress: null,
        credits: session.credits,
        createdAt: now,
        updatedAt: now,
      } satisfies Account;
    } else {
      return NextResponse.json({ account: null });
    }
  }

  return NextResponse.json({ account: toPublicAccount(account) });
}
