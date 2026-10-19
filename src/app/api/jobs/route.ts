import { ACCOUNT_COOKIE } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { enqueueJob, getOrCreateAccount, listJobs } from "@/lib/store";

export async function GET(req: NextRequest) {
  const accountId = req.cookies.get(ACCOUNT_COOKIE)?.value;
  const account = await getOrCreateAccount(accountId);
  const jobs = await listJobs(account.id);
  const res = NextResponse.json({ account, jobs });
  res.cookies.set(ACCOUNT_COOKIE, account.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export async function POST(req: NextRequest) {
  const accountId = req.cookies.get(ACCOUNT_COOKIE)?.value;
  const account = await getOrCreateAccount(accountId);
  const body = (await req.json()) as { prompt?: string; repoHint?: string };

  if (!body.prompt || body.prompt.trim().length < 8) {
    return NextResponse.json(
      { error: "Prompt must be at least 8 characters" },
      { status: 400 },
    );
  }

  try {
    const result = await enqueueJob({
      accountId: account.id,
      prompt: body.prompt,
      repoHint: body.repoHint,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enqueue failed";
    return NextResponse.json({ error: message }, { status: 402 });
  }
}
