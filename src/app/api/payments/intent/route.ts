import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_COOKIE, DAT_ASSET_ID, DAT_BURN_ADDRESS } from "@/lib/config";
import { getPackById } from "@/lib/economy";
import { createPaymentIntent, getOrCreateAccount } from "@/lib/store";

export async function POST(req: NextRequest) {
  const accountId = req.cookies.get(ACCOUNT_COOKIE)?.value;
  const account = await getOrCreateAccount(accountId);
  const body = (await req.json()) as { packId?: string };
  const pack = body.packId ? getPackById(body.packId) : undefined;
  if (!pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 400 });
  }

  const payment = await createPaymentIntent({
    accountId: account.id,
    packId: pack.id,
    datAmount: pack.dat,
    credits: pack.credits,
  });

  const res = NextResponse.json({
    payment,
    settlement: {
      assetId: DAT_ASSET_ID,
      amount: pack.dat,
      to: DAT_BURN_ADDRESS,
      burn: true,
      memo: payment.memo,
    },
  });
  res.cookies.set(ACCOUNT_COOKIE, account.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
