import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { pokerLogin } from "@/lib/poker-auth";
import { attachSession, createSessionToken } from "@/lib/session";
import {
  findAccountByUsername,
  loginLocalAccount,
  upsertPokerLinkedAccount,
} from "@/lib/store";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    username?: string;
    password?: string;
    countryCode?: string;
    /** Prefer Spirit Poker identity when both exist */
    preferPoker?: boolean;
  };

  if (!body.username || !body.password) {
    return NextResponse.json(
      { error: "username and password required" },
      { status: 400 },
    );
  }

  const username = body.username.trim();
  const password = body.password;
  const countryCode = (body.countryCode || "US").toUpperCase();

  try {
    const local = await findAccountByUsername(username);
    const preferPoker = body.preferPoker === true || !local?.passwordHash;

    if (!preferPoker && local?.passwordHash) {
      const account = await loginLocalAccount({ username, password });
      const token = await createSessionToken(account.id);
      const res = NextResponse.json({
        account: toPublicAccount(account),
        via: "local",
      });
      return attachSession(res, token, account.id);
    }

    // Spirit Poker shared account
    try {
      const poker = await pokerLogin({ username, password, countryCode });
      const account = await upsertPokerLinkedAccount({
        username: poker.username,
        pokerPlayerId: poker.playerId,
        sageAddress: poker.sageAddress,
      });
      const token = await createSessionToken(account.id);
      const res = NextResponse.json({
        account: toPublicAccount(account),
        via: "spirit-poker",
      });
      return attachSession(res, token, account.id);
    } catch (pokerErr) {
      // Fall back to local if poker rejected but local exists
      if (local?.passwordHash) {
        const account = await loginLocalAccount({ username, password });
        const token = await createSessionToken(account.id);
        const res = NextResponse.json({
          account: toPublicAccount(account),
          via: "local",
        });
        return attachSession(res, token, account.id);
      }
      throw pokerErr;
    }
  } catch (err) {
    let message = err instanceof Error ? err.message : "Login failed";
    if (
      err instanceof TypeError ||
      /fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)
    ) {
      message =
        "Could not reach the DAT sign-in service. Check your connection, or create a DAT STARCODER account.";
    } else if (
      /unknown|invalid|incorrect|password|unauthorized|failed/i.test(message)
    ) {
      message = "Check your DAT username and DAT password.";
    }
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
