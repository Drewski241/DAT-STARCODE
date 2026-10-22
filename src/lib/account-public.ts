import type { Account, PublicAccount } from "@/lib/types";

export function toPublicAccount(account: Account): PublicAccount {
  const {
    passwordHash: _pw,
    githubTokenEnc: _tok,
    ...rest
  } = account;
  void _pw;
  void _tok;
  return {
    ...rest,
    githubLogin: account.githubLogin ?? null,
    githubConnectedAt: account.githubConnectedAt ?? null,
    githubConnected: Boolean(account.githubTokenEnc && account.githubLogin),
  };
}
