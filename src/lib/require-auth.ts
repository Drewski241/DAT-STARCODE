import { NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { readSessionAccountId } from "@/lib/session";
import { getAccount, isRegisteredAccount } from "@/lib/store";
import type { Account } from "@/lib/types";

export async function requireRegisteredAccount(): Promise<
  { account: Account } | { error: NextResponse }
> {
  const accountId = await readSessionAccountId();
  if (!accountId) {
    return {
      error: NextResponse.json(
        { error: "Sign in required" },
        { status: 401 },
      ),
    };
  }
  const account = await getAccount(accountId);
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
