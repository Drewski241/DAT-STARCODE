# PLAN — secure treasury vault

## Goal
Ship ChiaLisp that cannot (a) fork lineage with a second CREATE_COIN or (b) claim
same-block flash interest from treasury — and that forms a **closable** three-spend
claim bundle (vault + treasury + interest_payout).

## Done when
1. `puzzles/savings_vault.clsp`, `puzzles/treasury_coin.clsp`, `puzzles/interest_payout.clsp` start with `(mod`.
2. Each spend path emits **exactly one** `CREATE_COIN` (51).
3. Modes 3–4 require `now_seconds - DEPOSIT_SECONDS >= MIN_HOLD_SECONDS`.
4. Interest uses curried `PRINCIPAL` + elapsed + `INTEREST_BPS` only.
5. Principal pays `OWNER_PH`; destinations are 32-byte atoms.
6. Treasury uses `ASSERT_MY_AMOUNT`; announcement digests match across the three puzzles.
7. `docs/SECURITY.md` + `docs/PUZZLE_HASH.md`; spend fixtures pass; `clvm_verify` / `spend_check` smoked.

## Security
- [ ] No unsigned solution puzzle hashes for CREATE_COIN without AGG_SIG_ME
- [ ] No AGG_SIG_UNSAFE
- [ ] Fail closed on bad mode / flash interest / interest > treasury amount
- [ ] Curry recreate uses `(c MOD_HASH (list …))` and matches cdv
