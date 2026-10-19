import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  return clearSession(res);
}
