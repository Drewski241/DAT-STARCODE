# Secure treasury / savings playbook

User is asking about a **compromised treasury** or savings↔treasury interaction (CircuitDAO-class).

## First action (mandatory)

Templates are **already seeded** into the workspace:

- `puzzles/savings_vault.clsp`
- `puzzles/treasury_coin.clsp`
- `puzzles/interest_payout.clsp` (third spend — pays interest after asserting treasury announcement)
- `include/sha256tree.clib` (required for `cdv clsp build`)
- `tests/spend-samples.json`
- `VULNERABILITY.md`, `PLAN.md`, `README.md`

1. `list_files` then `read_file` those puzzles.
2. **Edit them in place** — do **not** invent a new `secure_treasury.clsp` mega-file.
3. Each returned condition list must have **exactly one** `(list 51 …)` CREATE_COIN.
4. Keep min-hold interest + **matched puzzle announcements** (treasury `63`, vault/payout `61`).

## Hard requirements (verification fails without these)

1. **Announcement pairing** — same `claim-msg = (sha256tree (list 1 owed dest_ph))` on vault, treasury, and interest_payout.
2. **Curry treehash shape** — recreate with `(sha256tree (c MOD_HASH (list …)))`, then confirm via `puzzle_hash` / cdv curry (not a flat `(list MOD_HASH …)`).
3. **OWNER_PH binding** — withdraw/claim principal goes to curried `OWNER_PH` (not a free `dest_ph`).
4. **ASSERT_MY_AMOUNT (73)** on treasury before `amount - interest`.
5. **Lifecycle** — modes: open (1), withdraw principal (2), exit+interest (3), claim-only recreate (4).
6. **Spend fixtures** — flash / over-cover / zero-interest samples in `tests/spend-samples.json` must raise.

## Done when

1. All three `.clsp` files still start with `(mod`.
2. No sibling CREATE_COIN in one spend.
3. `docs/SECURITY.md` (short) + bare hash in `docs/PUZZLE_HASH.md` via `puzzle_hash` on `puzzles/savings_vault.clsp`.
4. Call `clvm_verify` or `spend_check` once (worker also auto-runs spend fixtures), then `done`.

## Forbidden

- Rewriting everything into one file with 5× CREATE_COIN
- Paying interest with a second CREATE_COIN from the vault or treasury
- Mismatched announcement digests / solution-chosen `claim_msg` on treasury
- Same-block flash interest (skip min hold)
- Common Lisp stubs
- Burning all 40 steps on rewrites — seed files are the solution; refine and verify
