import { NextRequest, NextResponse } from "next/server";
import { confirmPayment } from "@/lib/store";

export async function POST(req: NextRequest) {
  const accountId = req.cookies.get("dat_starcoder_account")?.value;
  if (!accountId) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }

  const body = (await req.json()) as {
    paymentId?: string;
    txId?: string;
    demo?: boolean;
  };

  if (!body.paymentId) {
    return NextResponse.json({ error: "paymentId required" }, { status: 400 });
  }

  try {
    const result = await confirmPayment({
      paymentId: body.paymentId,
      txId: body.txId,
      demo: body.demo ?? true,
    });
    if (result.payment.accountId !== accountId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Confirm failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
