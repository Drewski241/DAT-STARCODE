/**
 * Bridge to DAT Spirit Poker (datspiritpoker.com) account API.
 * Existing poker usernames/passwords can sign in to DAT STARCODER.
 */

export const POKER_API_BASE =
  process.env.SPIRIT_POKER_API_BASE ?? "https://datspiritpoker.com";

export const POKER_TERMS_VERSION =
  process.env.SPIRIT_POKER_TERMS_VERSION ?? "2026-09-17";

export type PokerLoginResult = {
  token: string;
  playerId: string;
  username: string;
  sageAddress?: string | null;
};

export async function pokerLogin(input: {
  username: string;
  password: string;
  countryCode: string;
}): Promise<PokerLoginResult> {
  const res = await fetch(`${POKER_API_BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      username: input.username,
      password: input.password,
      countryCode: input.countryCode,
      ageConfirmed: true,
      termsAccepted: true,
      termsVersion: POKER_TERMS_VERSION,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    token?: string;
    playerId?: string;
    username?: string;
    sageAddress?: string | null;
  };
  if (!res.ok) {
    throw new Error(data.error ?? `Poker login failed (${res.status})`);
  }
  if (!data.token || !data.playerId || !data.username) {
    throw new Error("Poker login returned an incomplete session");
  }
  return {
    token: data.token,
    playerId: data.playerId,
    username: data.username,
    sageAddress: data.sageAddress ?? null,
  };
}

export async function pokerMe(token: string) {
  const res = await fetch(`${POKER_API_BASE}/v1/auth/me`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ?? `Poker session invalid (${res.status})`,
    );
  }
  return data as {
    username?: string;
    playerId?: string;
    email?: string | null;
    sageAddress?: string | null;
  };
}

export async function fetchPokerPlayRequirements() {
  const res = await fetch(`${POKER_API_BASE}/v1/auth/play-requirements`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    return {
      ok: false,
      minAge: 18,
      blockedCountryCodes: [] as string[],
    };
  }
  return res.json() as Promise<{
    ok: boolean;
    minAge: number;
    blockedCountryCodes: string[];
    turnstileSiteKey?: string;
  }>;
}
