import { NextRequest, NextResponse } from "next/server";
import { toPublicAccount } from "@/lib/account-public";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { confirmPayment } from "@/lib/store";

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
  if (!demo && !body.txId) {
    return NextResponse.json(
      { error: "txId required for live burns" },
      { status: 400 },
    );
  }

  try {
    const result = await confirmPayment({
      paymentId: body.paymentId,
      txId: body.txId,
      demo,
    });
    if (result.payment.accountId !== auth.account.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({
      payment: result.payment,
      account: toPublicAccount(result.account),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Confirm failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
