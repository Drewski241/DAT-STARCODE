# Security notes — treasury-backed savings vault

## Fixes vs CircuitDAO-class bugs

1. **No lineage spoof:** each spend returns exactly one `CREATE_COIN` (51). Interest is never a second vault/treasury child.
2. **No same-block flash interest:** `DEPOSIT_SECONDS` is curried; modes 3–4 require `elapsed >= MIN_HOLD_SECONDS`.
3. **Interest math:** `principal * INTEREST_BPS * elapsed / (10000 * 31536000)` — not a solution-supplied discounted balance.
4. **32-byte destinations + OWNER_PH:** principal withdraw/claim pays curried `OWNER_PH` only.
5. **Treasury cover + bind amount:** `ASSERT_MY_AMOUNT` (73) then `amount >= interest` before recreate.
6. **Closable announcements:** treasury `CREATE_PUZZLE_ANNOUNCEMENT` (63) with `claim-msg = (sha256tree (list 1 owed dest))`; vault and `interest_payout` `ASSERT_PUZZLE_ANNOUNCEMENT` (61) on `sha256(TREASURY_PH claim-msg)`.
7. **Curry treehash:** recreate via `(sha256tree (c MOD_HASH (list …)))`; confirm with cdv / `puzzle_hash`.

## Files

- `puzzles/savings_vault.clsp`
- `puzzles/treasury_coin.clsp`
- `puzzles/interest_payout.clsp`
- `tests/spend-samples.json`
