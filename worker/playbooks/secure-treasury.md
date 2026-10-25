# Secure treasury / savings playbook

User is asking about a **compromised treasury** or savings↔treasury interaction (CircuitDAO-class).

## First action (mandatory)

Templates are **already seeded** into the workspace:

- `puzzles/savings_vault.clsp`
- `puzzles/treasury_coin.clsp`
- `puzzles/interest_payout.clsp` (third spend — pays interest to curried `OWNER_PH`)
- `include/sha256tree.clib` (optional; puzzles inline `sha256tree`)
- `tests/spend-samples.json` + `tests/three-spend-claim.json`
- `VULNERABILITY.md`, `PLAN.md`, `README.md`

1. `list_files` then `read_file` those puzzles.
2. **Edit them in place** — do **not** invent a new `secure_treasury.clsp` mega-file.
3. Each file must start with `(mod` (after `;` comments). Keep `sha256tree` as an inner `defun` — never move `(include …)` above `(mod`.
4. Each returned condition list must have **exactly one** `(list 51 …)` CREATE_COIN.
5. Keep min-hold interest + **matched puzzle announcements** (treasury `63`, vault/payout `61`).

## Hard requirements (verification fails without these)

1. **Announcement pairing** — same `claim-msg = (sha256tree (list 1 owed OWNER_PH))` on vault, treasury, and interest_payout.
2. **Curry treehash shape** — recreate with `(sha256tree (c MOD_HASH (list …)))`, then confirm via `puzzle_hash` / cdv curry (not a flat `(list MOD_HASH …)`).
3. **OWNER_PH binding** — withdraw/claim principal **and** interest payout go to curried `OWNER_PH` (no free `dest_ph`).
4. **ASSERT_MY_AMOUNT (73)** on treasury before `amount - interest`.
5. **Mode-4 accrual reset** — claim-only recreates with `DEPOSIT_SECONDS := now_seconds` so the same hold window cannot be claimed twice.
6. **Lifecycle** — modes: open (1), withdraw principal (2), exit+interest (3), claim-only recreate (4).
7. **Spend fixtures** — flash / over-cover / zero-interest samples must raise; three-spend happy-path halves must succeed.

## Trust model (AUTHORIZER_PK)

| Key | Signs | Teaching note |
| --- | --- | --- |
| `AUTHORIZER_PK` | Mode / amount / claim intents (`AGG_SIG_ME` 50) | Protocol or operator key in custodial teaching sketches; for a non-custodial variant, require owner-only sigs and drop protocol auth. |
| `OWNER_PH` | Destination only (curried) | Not a pubkey — puzzle hash funds return to. Interest cannot be redirected. |

Document which key may authorize claim vs withdraw in `docs/SECURITY.md` if you change the trust model.

## Done when

1. All three `.clsp` files still start with `(mod`.
2. No sibling CREATE_COIN in one spend.
3. `docs/SECURITY.md` (short) + bare hash in `docs/PUZZLE_HASH.md` via `puzzle_hash` on `puzzles/savings_vault.clsp`.
4. Call `clvm_verify` or `spend_check` once (worker also auto-runs spend fixtures), then `done`.

## Real-funds follow-on (when the prompt asks)

If the user mentions **real funds**, **mainnet**, **owner-bound**, **OWNER_PK**, **singleton**, or **CAT**, also follow `secure-treasury-real-funds.md` and `docs/REAL_FUNDS.md`. Keep v2 CircuitDAO fixes green, then evolve auth → three-spend integration docs/tests → singleton/CAT scaffold. External review comes after those phases — do not claim impenetrable.

## Forbidden

- Rewriting everything into one file with 5× CREATE_COIN
- Paying interest with a second CREATE_COIN from the vault or treasury
- Free `dest_ph` on payout / mismatched announcement digests
- Mode-4 recreate that keeps the old `DEPOSIT_SECONDS` (double-claim accrual)
- Same-block flash interest (skip min hold)
- Common Lisp stubs
- Burning all 40 steps on rewrites — seed files are the solution; refine and verify
