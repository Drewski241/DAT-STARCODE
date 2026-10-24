# Secure treasury / savings playbook

User is asking about a **compromised treasury** or savings↔treasury interaction (CircuitDAO-class).

## First action (mandatory)

Templates are **already seeded** into the workspace:

- `puzzles/savings_vault.clsp`
- `puzzles/treasury_coin.clsp`
- `VULNERABILITY.md`, `PLAN.md`, `README.md`

1. `list_files` then `read_file` those puzzles.
2. **Edit them in place** — do **not** invent a new `secure_treasury.clsp` mega-file.
3. Each returned condition list must have **exactly one** `(list 51 …)` CREATE_COIN.
4. Keep min-hold interest + announcement pattern for treasury cover.

## Done when

1. Both `.clsp` files still start with `(mod`.
2. No sibling CREATE_COIN in one spend (verification fails hard if you add a second child).
3. Mode 3 still requires curried deposit time + MIN_HOLD_SECONDS.
4. `docs/SECURITY.md` (short) + puzzle hash via `puzzle_hash` on `puzzles/savings_vault.clsp`.
5. Call `clvm_verify` or `spend_check` once, then `done`.

## Forbidden

- Rewriting everything into one file with 5× CREATE_COIN
- Paying interest with a second CREATE_COIN from the vault
- Same-block flash interest (skip min hold)
- Common Lisp stubs
- Burning all 40 steps on rewrites — seed files are the solution; refine and verify
