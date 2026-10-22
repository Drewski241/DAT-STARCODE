import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireRegisteredAccount } from "@/lib/require-auth";
import {
  githubAuthorizeUrl,
  githubConfigured,
  githubRedirectUri,
} from "@/lib/github";

export async function GET(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) return auth.error;

  if (!githubConfigured()) {
    return NextResponse.json(
      {
        error:
          "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
      },
      { status: 503 },
    );
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = githubRedirectUri(req.url);
  const url = githubAuthorizeUrl({ state, redirectUri });

  const res = NextResponse.redirect(url);
  res.cookies.set("dat_gh_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.COOKIE_SECURE === "1",
  });
  return res;
}
