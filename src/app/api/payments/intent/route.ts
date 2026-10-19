import { NextRequest, NextResponse } from "next/server";
import { CREDIT_PACKS, DAT_ASSET_ID, DAT_BURN_ADDRESS } from "@/lib/config";
import { createPaymentIntent, getOrCreateAccount } from "@/lib/store";

export async function POST(req: NextRequest) {
  const accountId = req.cookies.get("dat_starcoder_account")?.value;
  const account = await getOrCreateAccount(accountId);
  const body = (await req.json()) as { packId?: string };
  const pack = CREDIT_PACKS.find((p) => p.id === body.packId);
  if (!pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 400 });
  }

  const payment = await createPaymentIntent({
    accountId: account.id,
    packId: pack.id,
    datAmount: pack.dat,
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
  res.cookies.set("dat_starcoder_account", account.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
