# PLAN — secure treasury vault

## Goal
Ship ChiaLisp that cannot (a) fork lineage with a second CREATE_COIN or (b) claim
same-block flash interest from treasury.

## Done when
1. `puzzles/secure_treasury_vault.clsp` and `puzzles/secure_treasury_coin.clsp` start with `(mod`.
2. Each spend path emits **at most one** `CREATE_COIN` (51).
3. Mode 3 requires `now_seconds - DEPOSIT_SECONDS >= MIN_HOLD_SECONDS`.
4. Interest uses curried `PRINCIPAL` + elapsed + `INTEREST_BPS` only.
5. Destinations checked as 32-byte atoms.
6. `docs/SECURITY.md` restates the checklist; puzzle hash documented if cdv available.
7. `clvm_verify` / `spend_check` run on smoke solutions (or tooling failure noted).

## Security
- [ ] No unsigned solution puzzle hashes for CREATE_COIN without AGG_SIG_ME
- [ ] No AGG_SIG_UNSAFE
- [ ] Fail closed on bad mode
- [ ] Treasury cover: `amount > interest_amount - 1`
