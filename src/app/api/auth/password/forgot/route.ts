import { NextRequest, NextResponse } from "next/server";
import { pokerForgotPassword } from "@/lib/poker-auth";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    username?: string;
    email?: string;
  };
  if (!body.username?.trim() || !body.email?.trim()) {
    return NextResponse.json(
      { error: "DAT username and email are required" },
      { status: 400 },
    );
  }
  try {
    const result = await pokerForgotPassword({
      username: body.username,
      email: body.email,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not send reset code";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
