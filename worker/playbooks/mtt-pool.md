# MTT pool coin playbook

User goal (even from a short prompt): an on-chain **tournament pool** that takes fixed buy-ins and pays **top 3** (DAT / ChiaLisp).

## Done when

1. `puzzles/mtt_pool.clsp` is real ChiaLisp (`(mod …)`), not Common Lisp.
2. Curry (setup-time, fixed puzzle hash):  
   `BUY_IN_MOJOS MAX_PLAYERS SPLIT_1 SPLIT_2 SPLIT_3 AUTHORIZER_PK POOL_PUZZLE_HASH`
3. Solution: `mode pool_amount count w1 w2 w3`  
   - mode 1 deposit: `count < MAX_PLAYERS` → `CREATE_COIN` back to **`POOL_PUZZLE_HASH`** with `pool_amount + BUY_IN`  
   - mode 2 settle: `AGG_SIG_ME` + three `CREATE_COIN`s; 3rd gets **remainder**
4. `docs/MTT_POOL.md` matches the puzzle (including that **POOL_PUZZLE_HASH is computed at setup**, before buy-ins).
5. If `puzzle_hash` tool / cdv is available: run it and put the hex hash in `docs/MTT_POOL.md` under `## Pool puzzle hash` (or note cdv missing).
6. Remove stub junk (`pool_coin.py`, fake `.cl`, duplicate sage files) with real `rm`.

## First action

Write `PLAN.md` with: Goal / Done when / Files — then implement. Keep user-facing prompts short; you already know the end state.

## Hash intuition

Buy-ins do **not** create the puzzle hash. Curry launch constants → treehash → curry that bytes32 as `POOL_PUZZLE_HASH` → deposits recreate the **same** hash; only coin amount / solution `count` change.
