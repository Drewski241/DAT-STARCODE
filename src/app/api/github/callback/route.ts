import { NextRequest, NextResponse } from "next/server";
import { encryptSecret } from "@/lib/github-crypto";
import {
  exchangeGithubCode,
  githubGetUser,
  githubRedirectUri,
} from "@/lib/github";
import { requireRegisteredAccount } from "@/lib/require-auth";
import { setGithubConnection } from "@/lib/store";

export async function GET(req: NextRequest) {
  const auth = await requireRegisteredAccount();
  if ("error" in auth) {
    return NextResponse.redirect(new URL("/account", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("dat_gh_oauth_state")?.value;
  const err = req.nextUrl.searchParams.get("error");

  const studio = new URL("/studio", req.url);
  if (err) {
    studio.searchParams.set("github", "denied");
    return NextResponse.redirect(studio);
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    studio.searchParams.set("github", "state");
    return NextResponse.redirect(studio);
  }

  try {
    const redirectUri = githubRedirectUri(req.url);
    const { accessToken } = await exchangeGithubCode({ code, redirectUri });
    const user = await githubGetUser(accessToken);
    await setGithubConnection(auth.account.id, {
      login: user.login,
      tokenEnc: encryptSecret(accessToken),
    });
    studio.searchParams.set("github", "connected");
  } catch {
    studio.searchParams.set("github", "error");
  }

  const res = NextResponse.redirect(studio);
  res.cookies.set("dat_gh_oauth_state", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
