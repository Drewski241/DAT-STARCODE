import { NextRequest, NextResponse } from "next/server";
import { DAT_ASSET_ID, DAT_BURN_ADDRESS } from "@/lib/config";
import { getPackById } from "@/lib/economy";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { createPaymentIntent } from "@/lib/store";

export async function POST(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const body = (await req.json()) as { packId?: string };
  const pack = body.packId ? getPackById(body.packId) : undefined;
  if (!pack) {
    return NextResponse.json({ error: "Unknown pack" }, { status: 400 });
  }

  const payment = await createPaymentIntent({
    accountId: auth.account.id,
    packId: pack.id,
    datAmount: pack.dat,
    credits: pack.credits,
  });

  return NextResponse.json({
    payment,
    settlement: {
      assetId: DAT_ASSET_ID,
      amount: pack.dat,
      to: DAT_BURN_ADDRESS,
      burn: true,
      memo: payment.memo,
    },
  });
}
