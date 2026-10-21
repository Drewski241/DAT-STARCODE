import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCOUNT_COOKIE } from "@/lib/config";

const SESSION_COOKIE = "dat_starcoder_session";

function secretKey() {
  const secret =
    process.env.AUTH_SECRET ??
    process.env.WORKER_API_KEY ??
    "dev-auth-secret-change-me";
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(accountId: string) {
  return new SignJWT({ sub: accountId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());
}

export async function readSessionAccountId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

function cookieSecure() {
  // Amplify serves HTTPS; without Secure the browser may drop the session.
  return (
    process.env.NODE_ENV === "production" ||
    process.env.COOKIE_SECURE === "1"
  );
}

export function attachSession(
  res: NextResponse,
  token: string,
  accountId: string,
) {
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: cookieSecure(),
  };
  res.cookies.set(SESSION_COOKIE, token, base);
  res.cookies.set(ACCOUNT_COOKIE, accountId, base);
  return res;
}

export function clearSession(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(ACCOUNT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export { SESSION_COOKIE };
