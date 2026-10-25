# Real-funds hardening playbook (DAT STARCODER)

The user wants the **seeded v2 treasury/savings puzzles evolved toward real funds**.
You do the work in the workspace — templates are the starting point, not the finish.

## Mandatory first reads

1. `docs/REAL_FUNDS.md` (seeded ladder)
2. `puzzles/savings_vault.clsp`, `puzzles/treasury_coin.clsp`, `puzzles/interest_payout.clsp`
3. `tests/spend-samples.json`, `tests/three-spend-claim.json`, `docs/SECURITY.md`

## Execute in order (one phase per burst if steps are tight)

### B — Owner-bound auth
- Vault + `interest_payout`: `OWNER_PK` for all `AGG_SIG_ME` (50); keep curried `OWNER_PH` destinations.
- Treasury: `TREASURY_PK` only (custodian of interest pool). Document split trust in `docs/SECURITY.md`.
- Do not leave a protocol `AUTHORIZER_PK` signing vault withdraw/claim.

### C — Three-spend integration
- Keep announcement pairing: treasury `63` / vault+payout `61`, same `claim-msg = (sha256tree (list 1 owed OWNER_PH))`.
- Expand `tests/three-spend-claim.json` so each half names a passing sample.
- Run fixtures / `spend_check` once; note mempool/agg-sig gap honestly.

### D — Singleton / CAT (scaffold)
- Add `docs/SINGLETON_CAT.md`: launcher, lineage, why recreate-only ≠ singleton, CAT wrap note.
- Minimal code only if it stays one `CREATE_COIN` per path and still `(mod`-first.

## Verification

1. Static: still exactly one `(list 51 …)` per path; `claim-msg (owed owner)` on payout.
2. `puzzle_hash` on `puzzles/savings_vault.clsp` → bare hex in `docs/PUZZLE_HASH.md`.
3. Spend fixtures green; then `done`.

## Worker rescue

Real-funds turns **keep** puzzle edits that diverge from v2 templates (OWNER_PK / TREASURY_PK). The worker only force-reseeds if static secure-checks fail. Finish Phase B renames even if the files no longer match `templates/secure-treasury/puzzles/*`.

## Forbidden

- Mega-file with sibling `CREATE_COIN`s
- Claiming “impenetrable” / mainnet-ready without documenting review gaps
- Burning all steps on Phase D before B and C are done
- Free `dest_ph` on interest
- Reverting to `AUTHORIZER_PK` just to match the seeded template
