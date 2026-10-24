# Secure treasury template (DAT STARCODER) — v2

Minimal ChiaLisp patterns that encode fixes for the **CircuitDAO treasury / savings**
class of bugs (2025 Zellic finding + 2026 mainnet treasury drain), plus a **closable**
three-spend claim bundle the agent can create, test, and harden.

| File | Role |
| --- | --- |
| `VULNERABILITY.md` | What broke and why |
| `puzzles/savings_vault.clsp` | Vault: one child, min-hold, OWNER_PH, mode-4 deposit reset |
| `puzzles/treasury_coin.clsp` | Treasury: ASSERT_MY_AMOUNT, OWNER_PH claim-msg, one child remainder |
| `puzzles/interest_payout.clsp` | Third spend: curried OWNER_PH → CREATE_COIN interest |
| `tests/spend-samples.json` | Fail-closed + three-spend happy-path halves |
| `tests/three-spend-claim.json` | Bundle metadata (shared claim-msg) |
| `docs/SECURITY.md` | Checklist + trust model |
| `PLAN.md` | Implementation checklist |

Legacy filenames `secure_treasury_vault.clsp` / `secure_treasury_coin.clsp` mirror v2.

## Capability ladder (what “done” means)

1. **Static verify** — sibling CREATE_COIN, OWNER_PH use, ASSERT_MY_AMOUNT, announcement pairing, curry `(c MOD_HASH …)` shape, mode-4 reset, owner-bound payout.
2. **Spend fixtures** — worker auto-runs `tests/spend-samples.json` (expectFail must raise; happy halves must succeed).
3. **cdv puzzle hash** — document bare hex in `docs/PUZZLE_HASH.md`; recreation hash must match curry.
4. **Not yet** — full mempool / AGG_SIG aggregation simulator (use chia testnet or `cdv` locally for that).

## Studio prompt

```
Write secure ChiaLisp (.clsp) for a treasury-backed savings vault.
Fix CircuitDAO-style bugs: no multi CREATE_COIN lineage spoof,
no same-block flash-loan interest, 32-byte puzzle hashes, treasury cover.
Start from templates/secure-treasury/. Keep interest_payout.clsp so the
claim bundle is closable (vault + treasury + payout). Interest must pay
curried OWNER_PH; mode-4 must reset the deposit clock.
```

Auto routes this to **Coder 14B** + seeds these files into the workspace. Edit in place; do not invent a mega-file with multiple CREATE_COIN siblings.
