import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCOUNT_COOKIE } from "@/lib/config";

const SESSION_COOKIE = "dat_starcoder_session";

export type SessionClaims = {
  accountId: string;
  username: string | null;
  credits: number;
};

function secretKey() {
  // Never fall back to WORKER_API_KEY — rotating the worker key was
  // invalidating sessions and causing login bounce storms.
  const secret =
    process.env.AUTH_SECRET?.trim() || "dev-auth-secret-change-me";
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(input: {
  accountId: string;
  username?: string | null;
  credits?: number;
}) {
  return new SignJWT({
    sub: input.accountId,
    username: input.username ?? null,
    credits: input.credits ?? 0,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey());
}

export async function readSession(): Promise<SessionClaims | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== "string") return null;
    return {
      accountId: payload.sub,
      username:
        typeof payload.username === "string" ? payload.username : null,
      credits: typeof payload.credits === "number" ? payload.credits : 0,
    };
  } catch {
    return null;
  }
}

export async function readSessionAccountId(): Promise<string | null> {
  const session = await readSession();
  return session?.accountId ?? null;
}

function cookieSecure() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.COOKIE_SECURE === "1"
  );
}

/**
 * Share session across apex + www (e.g. datstarcoder.com and www.datstarcoder.com).
 * Set COOKIE_DOMAIN=.datstarcoder.com in Amplify. Leading dot is required.
 */
function cookieDomain(): string | undefined {
  const raw = process.env.COOKIE_DOMAIN?.trim();
  if (!raw) return undefined;
  return raw.startsWith(".") ? raw : `.${raw}`;
}

function sessionCookieOptions(maxAge: number) {
  const domain = cookieDomain();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure: cookieSecure(),
    ...(domain ? { domain } : {}),
  };
}

export function attachSession(
  res: NextResponse,
  token: string,
  accountId: string,
) {
  const base = sessionCookieOptions(60 * 60 * 24 * 30);
  res.cookies.set(SESSION_COOKIE, token, base);
  res.cookies.set(ACCOUNT_COOKIE, accountId, base);
  return res;
}

export function clearSession(res: NextResponse) {
  const base = sessionCookieOptions(0);
  res.cookies.set(SESSION_COOKIE, "", base);
  res.cookies.set(ACCOUNT_COOKIE, "", base);
  return res;
}

export { SESSION_COOKIE };
