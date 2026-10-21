import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { attachSession, createSessionToken } from "@/lib/session";
import { registerLocalAccount } from "@/lib/store";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    username?: string;
    password?: string;
    email?: string;
  };
  if (!body.username || !body.password) {
    return NextResponse.json(
      { error: "username and password required" },
      { status: 400 },
    );
  }
  try {
    const account = await registerLocalAccount({
      username: body.username,
      password: body.password,
      email: body.email,
    });
    const token = await createSessionToken({
      accountId: account.id,
      username: account.username,
      credits: account.credits,
    });
    const res = NextResponse.json({ account: toPublicAccount(account) });
    return attachSession(res, token, account.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Register failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
