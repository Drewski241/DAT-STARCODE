# Security notes — treasury-backed savings vault

## Fixes vs CircuitDAO-class bugs

1. **No lineage spoof:** each spend returns exactly one `CREATE_COIN` (51). Interest is never a second vault child.
2. **No same-block flash interest:** `DEPOSIT_SECONDS` is curried; mode 3 requires `elapsed >= MIN_HOLD_SECONDS`.
3. **Interest math:** `principal * INTEREST_BPS * elapsed / (10000 * 31536000)` — not a solution-supplied discounted balance.
4. **32-byte destinations:** `assert-b32` on owner / withdraw puzzle hashes.
5. **Treasury cover:** treasury coin asserts `amount >= interest` before recreating with the remainder; vault announces the claim for a concurrent treasury spend.

## Files

- `puzzles/savings_vault.clsp`
- `puzzles/treasury_coin.clsp`
