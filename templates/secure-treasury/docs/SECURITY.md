# Security notes — treasury-backed savings vault (v2)

## Fixes vs CircuitDAO-class bugs

1. **No lineage spoof:** each spend returns exactly one `CREATE_COIN` (51). Interest is never a second vault/treasury child.
2. **No same-block flash interest:** `DEPOSIT_SECONDS` is curried; modes 3–4 require `elapsed >= MIN_HOLD_SECONDS`.
3. **Interest math:** `principal * INTEREST_BPS * elapsed / (10000 * 31536000)` — not a solution-supplied discounted balance.
4. **32-byte destinations + OWNER_PH:** principal withdraw/claim and interest payout pay curried `OWNER_PH` only (no free `dest_ph`).
5. **Treasury cover + bind amount:** `ASSERT_MY_AMOUNT` (73) then `amount >= interest` before recreate.
6. **Closable announcements:** treasury `CREATE_PUZZLE_ANNOUNCEMENT` (63) with `claim-msg = (sha256tree (list 1 owed OWNER_PH))`; vault and `interest_payout` `ASSERT_PUZZLE_ANNOUNCEMENT` (61) on `sha256(TREASURY_PH claim-msg)`.
7. **Curry treehash:** recreate via `(sha256tree (c MOD_HASH (list …)))`; confirm with cdv / `puzzle_hash`.
8. **Mode-4 accrual reset:** claim-only recreates with `DEPOSIT_SECONDS := now_seconds` so the same hold window cannot be claimed twice.

## Trust model (v2 seeded default)

- `AUTHORIZER_PK` — signs mode / claim intents (`AGG_SIG_ME`). Custodial teaching default: protocol/operator key.
- `OWNER_PH` — curried destination puzzle hash; interest and principal cannot be redirected via solution atoms.

## Real-funds target (agent Phase B — see `docs/REAL_FUNDS.md`)

| Key | Role |
| --- | --- |
| `OWNER_PK` | Signs vault + interest_payout spends (owner-bound principal/interest claim) |
| `TREASURY_PK` | Custodian of the shared interest pool only |
| `OWNER_PH` | Curried payout destination (unchanged) |

Do **not** call the design mainnet-ready until singleton/CAT scaffold + external review are done (`docs/REAL_FUNDS.md` Phases C–D).

## Files

- `puzzles/savings_vault.clsp`
- `puzzles/treasury_coin.clsp`
- `puzzles/interest_payout.clsp`
- `tests/spend-samples.json`
- `tests/three-spend-claim.json`
- `docs/REAL_FUNDS.md`
