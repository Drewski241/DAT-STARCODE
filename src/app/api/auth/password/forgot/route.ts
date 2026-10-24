import { NextRequest, NextResponse } from "next/server";
import { pokerForgotPassword } from "@/lib/poker-auth";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    email?: string;
  };
  if (!body.email?.trim()) {
    return NextResponse.json(
      { error: "Email is required" },
      { status: 400 },
    );
  }
  try {
    const result = await pokerForgotPassword({
      email: body.email,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not send reset code";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
