import { NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { readSession } from "@/lib/session";
import { getAccount, isRegisteredAccount } from "@/lib/store";
import type { Account } from "@/lib/types";

function accountFromSession(session: {
  accountId: string;
  username: string | null;
  credits: number;
}): Account | null {
  if (!session.username) return null;
  const now = new Date().toISOString();
  return {
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
  };
}

export async function requireRegisteredAccount(): Promise<
  { account: Account } | { error: NextResponse }
> {
  const session = await readSession();
  if (!session) {
    return {
      error: NextResponse.json(
        { error: "Sign in required" },
        { status: 401 },
      ),
    };
  }

  // Prefer live store; fall back to JWT claims so S3 races don't log users out.
  let account = await getAccount(session.accountId);
  if (!account || !isRegisteredAccount(account)) {
    await new Promise((r) => setTimeout(r, 100));
    account = await getAccount(session.accountId);
  }
  if (!account || !isRegisteredAccount(account)) {
    account = accountFromSession(session);
  }
  if (!account || !isRegisteredAccount(account)) {
    return {
      error: NextResponse.json(
        { error: "Create an account or sign in to continue" },
        { status: 401 },
      ),
    };
  }
  return { account };
}

export function publicAccountJson(account: Account, extra?: object) {
  return NextResponse.json({ account: toPublicAccount(account), ...extra });
}
