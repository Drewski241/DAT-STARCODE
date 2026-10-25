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
5. Principal **and** interest pay curried `OWNER_PH` (no free `dest_ph`); destinations are 32-byte atoms.
6. Treasury uses `ASSERT_MY_AMOUNT`; `claim-msg = (sha256tree (list 1 owed OWNER_PH))` matches across the three puzzles.
7. Mode-4 claim-only recreates with `DEPOSIT_SECONDS := now_seconds` (accrual reset).
8. `docs/SECURITY.md` + `docs/PUZZLE_HASH.md`; spend fixtures + three-spend halves pass.

## Security
- [x] No unsigned solution puzzle hashes for CREATE_COIN without AGG_SIG_ME
- [x] No AGG_SIG_UNSAFE
- [x] Fail closed on bad mode / flash interest / interest > treasury amount
- [x] Curry recreate uses `(c MOD_HASH (list …))` and matches cdv
- [x] Owner-bound payout + mode-4 deposit reset

## Phase B+ (real funds — agent work when prompted)

See `docs/REAL_FUNDS.md`. When the user asks for real funds / owner-bound / singleton / CAT:

- [ ] Vault + payout sign with `OWNER_PK` (not protocol `AUTHORIZER_PK`)
- [ ] Treasury uses `TREASURY_PK`; trust split documented in `docs/SECURITY.md`
- [ ] Three-spend bundle metadata + fixtures named and green
- [ ] `docs/SINGLETON_CAT.md` (or REAL_FUNDS Phase D) written; no false “impenetrable” claims
- [ ] Bare hash refreshed; ready for external review
