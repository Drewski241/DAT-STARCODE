import { NextResponse } from "next/server";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { getPayments } from "@/lib/store";

/** List this account's pending burn intents (for Check burn / resume after slow confirm). */
export async function GET() {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  const payments = await getPayments(auth.account.id);
  const pending = payments
    .filter((p) => p.status === "pending")
    .map((p) => ({
      id: p.id,
      packId: p.packId,
      datAmount: p.datAmount,
      credits: p.credits,
      memo: p.memo,
      createdAt: p.createdAt,
    }));

  return NextResponse.json({ pending });
}
