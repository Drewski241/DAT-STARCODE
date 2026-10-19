import type { Account, PublicAccount } from "@/lib/types";

export function toPublicAccount(account: Account): PublicAccount {
  const { passwordHash: _pw, ...rest } = account;
  void _pw;
  return rest;
}
