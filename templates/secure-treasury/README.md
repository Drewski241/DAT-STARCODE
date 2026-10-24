# Secure treasury template (DAT STARCODER)

Minimal ChiaLisp patterns that encode fixes for the **CircuitDAO treasury / savings**
class of bugs (2025 Zellic finding + 2026 mainnet treasury drain), plus closable
announcement wiring so the agent can **create, test, and harden** puzzles.

| File | Role |
| --- | --- |
| `VULNERABILITY.md` | What broke and why |
| `puzzles/savings_vault.clsp` | Vault: one child, min-hold, OWNER_PH, puzzle-announce claim |
| `puzzles/treasury_coin.clsp` | Treasury: ASSERT_MY_AMOUNT, one child remainder, CREATE_PUZZLE_ANNOUNCEMENT |
| `puzzles/interest_payout.clsp` | Third spend: assert announcement → CREATE_COIN interest |
| `tests/spend-samples.json` | Fail-closed brun/run samples (flash / cover / zero) |
| `docs/SECURITY.md` | Checklist |
| `PLAN.md` | Implementation checklist |

Legacy filenames `secure_treasury_vault.clsp` / `secure_treasury_coin.clsp` are superseded.

## Capability ladder (what “done” means)

1. **Static verify** — sibling CREATE_COIN, OWNER_PH use, ASSERT_MY_AMOUNT, announcement pairing, curry `(c MOD_HASH …)` shape.
2. **Spend fixtures** — worker auto-runs `tests/spend-samples.json` (expectFail must raise).
3. **cdv puzzle hash** — document bare hex in `docs/PUZZLE_HASH.md`; recreation hash must match curry.
4. **Not yet** — full mempool / AGG_SIG aggregation simulator (use chia testnet or `cdv` locally for that).

## Studio prompt

```
Write secure ChiaLisp (.clsp) for a treasury-backed savings vault.
Fix CircuitDAO-style bugs: no multi CREATE_COIN lineage spoof,
no same-block flash-loan interest, 32-byte puzzle hashes, treasury cover.
Start from templates/secure-treasury/. Keep interest_payout.clsp so the
claim bundle is closable (vault + treasury + payout).
```

Auto routes this to **Coder 14B** + seeds these files into the workspace. Edit in place; do not invent a mega-file with multiple CREATE_COIN siblings.
