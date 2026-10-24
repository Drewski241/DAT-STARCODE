import { NextRequest, NextResponse } from "next/server";
import { pokerResetPassword } from "@/lib/poker-auth";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    email?: string;
    resetCode?: string;
    password?: string;
  };
  if (!body.email?.trim() || !body.resetCode?.trim() || !body.password) {
    return NextResponse.json(
      { error: "Email, reset code, and new password are required" },
      { status: 400 },
    );
  }
  if (body.password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }
  try {
    const result = await pokerResetPassword({
      email: body.email,
      resetCode: body.resetCode,
      password: body.password,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not reset password";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
