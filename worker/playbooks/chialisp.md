# ChiaLisp playbook (DAT STARCODER)

You are writing **ChiaLisp** for the Chia blockchain — NOT Common Lisp, NOT Emacs Lisp, NOT Python.

## Forbidden (instant fail)

- `defparameter`, `defvar`, `loop`, `mapcar`, `let*`, `setf`, `getf`, `progn`
- Array index syntax like `winner_phs[0]`
- `(if (AGG_SIG_ME …) …)` — signatures are **emitted conditions**, not predicates
- Calling `clisp` / writing `.cl` Common Lisp demos / `pool_coin.py` simulations
- Claiming a file was deleted without `list_files` proof afterward

## Required shape

A puzzle file must start with `(mod (` and the program body must **return a list of conditions**.

```chialisp
(mod (
  BUY_IN_MOJOS
  MAX_PLAYERS
  SPLIT_1
  SPLIT_2
  SPLIT_3
  AUTHORIZER_PK
  ; --- solution ---
  mode
  arg1
  arg2
  arg3
)
  ; Prefer including condition codes when the repo has them; otherwise use integers:
  ; CREATE_COIN = 51, AGG_SIG_ME = 50
  (defun quotient_pct (amount pct)
    (quotient (* amount pct) 100)
  )

  ; mode 1 = deposit, mode 2 = settle
  (if (= mode 1)
    ; DEPOSIT: arg1 = previous_count, arg2 unused, arg3 unused
    ; Caller must create a coin of exactly BUY_IN_MOJOS into this puzzle.
    ; Recreate THIS same puzzle hash with amount increased off-chain by the coin set;
    ; enforce count < MAX_PLAYERS. Emit CREATE_COIN back to (my puzzle hash) pattern
    ; used by the project, or document lineage clearly in MTT_POOL.md.
    (if (< arg1 MAX_PLAYERS)
      (list
        (list 51 MY_PUZZLE_HASH BUY_IN_MOJOS)
      )
      (x)
    )
    ; SETTLE: arg1 = winner1_ph, arg2 = winner2_ph, arg3 = winner3_ph
    ; pool amount is the coin amount being spent (not trusted from solution alone in v1 —
    ; document that AUTHORIZER_PK attests winners + amounts via signed message).
    (list
      (list 50 AUTHORIZER_PK (sha256tree (list arg1 arg2 arg3)))
      (list 51 arg1 (quotient_pct POOL_AMOUNT_PLACEHOLDER SPLIT_1))
      (list 51 arg2 (quotient_pct POOL_AMOUNT_PLACEHOLDER SPLIT_2))
      (list 51 arg3 (quotient_pct POOL_AMOUNT_PLACEHOLDER SPLIT_3))
    )
  )
)
```

Notes for a real MTT pool (Mode C):

- Curry constants: buy-in, max players (500), splits (50/30/20), authorizer pubkey.
- Integer percent math: `(quotient (* amount pct) 100)` — never `(/ pct 100)` first.
- `f` / `r` for lists — never `[0]`.
- Emit `(list 50 pubkey msg)` for AGG_SIG_ME; do not wrap it in `if`.
- CREATE_COIN is `(list 51 puzzle_hash amount)`.
- Before finishing, `read_file` your `.clsp` and confirm it starts with `(mod` and contains no forbidden tokens.
- Before finishing, run `clvm_verify` (brun/run) and `puzzle_hash` (cdv). Missing worker tooling is a hard failure — never invent hashes or skip verify.

## Security checklist (required for any spendable puzzle)

1. **No unsigned destinations** — every `CREATE_COIN` puzzle hash is curried, signed via `AGG_SIG_ME`, or deterministically derived.
2. **Prefer `AGG_SIG_ME`** — avoid `AGG_SIG_UNSAFE` unless you document why replay across coins is impossible.
3. **Bind the coin** — use `ASSERT_MY_AMOUNT` / `ASSERT_MY_PUZZLEHASH` / `ASSERT_MY_COIN_ID` when amount or lineage must not drift.
4. **Fail closed** — bad mode / overflow / too many deposits → `(x)`, never a partial spend that leaks value.
5. **Exact amounts** — integer `quotient` math; last payout gets the remainder so mojos cannot vanish or inflate.
6. **Treat the solution as hostile** — any atom the spender provides can be attacker-chosen unless covered by a signature or curry constant.

Put a short “Security” subsection in `PLAN.md` or the companion docs answering these six points.

## Docs companion

If asked for `docs/MTT_POOL.md`, document curry order, deposit solution atoms, settle solution atoms, a numeric example (500 × buy-in → top-3 mojos), and the security notes above.
