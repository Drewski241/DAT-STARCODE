import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { requireRegisteredAccount } from "@/lib/require-auth";
import {
  confirmPayment,
  getPayment,
  listUsedBurnTxIds,
} from "@/lib/store";
import { verifyDatBurnOnChain } from "@/lib/verify-burn";

const allowDemo =
  process.env.ALLOW_DEMO_PAYMENTS === "1" ||
  process.env.NEXT_PUBLIC_ALLOW_DEMO_PAYMENTS === "1";

export async function POST(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const body = (await req.json()) as {
    paymentId?: string;
    txId?: string;
    demo?: boolean;
  };

  if (!body.paymentId) {
    return NextResponse.json({ error: "paymentId required" }, { status: 400 });
  }

  const demo = body.demo === true;
  if (demo && !allowDemo) {
    return NextResponse.json(
      {
        error:
          "Demo payments are disabled. Connect Sage and burn DAT on-chain.",
      },
      { status: 400 },
    );
  }

  const payment = await getPayment(body.paymentId);
  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }
  if (payment.accountId !== auth.account.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Already credited — idempotent success.
  if (payment.status === "confirmed" || payment.status === "demo") {
    return NextResponse.json({
      payment,
      account: toPublicAccount(auth.account),
      verified: payment.status === "confirmed",
    });
  }

  try {
    if (demo) {
      const result = await confirmPayment({
        paymentId: body.paymentId,
        txId: body.txId,
        demo: true,
      });
      return NextResponse.json({
        payment: result.payment,
        account: toPublicAccount(result.account),
        verified: false,
        demo: true,
      });
    }

    const used = await listUsedBurnTxIds();
    const verification = await verifyDatBurnOnChain(payment, {
      usedCoinIds: used,
    });

    if (!verification.ok) {
      return NextResponse.json(
        {
          error: verification.message,
          pending: true,
        },
        { status: 202 },
      );
    }

    const result = await confirmPayment({
      paymentId: body.paymentId,
      txId: verification.coinId,
      demo: false,
    });

    return NextResponse.json({
      payment: result.payment,
      account: toPublicAccount(result.account),
      verified: true,
      verification: {
        coinId: verification.coinId,
        height: verification.height,
        memoMatched: verification.memoMatched,
        explorerUrl: verification.explorerUrl,
        amountMojos: verification.amountMojos,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Confirm failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
