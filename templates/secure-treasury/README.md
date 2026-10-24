# Secure treasury template (DAT STARCODER)

Minimal ChiaLisp patterns that encode fixes for the **CircuitDAO treasury / savings**
class of bugs (2025 Zellic finding + 2026 mainnet treasury drain).

| File | Role |
| --- | --- |
| `VULNERABILITY.md` | What broke and why |
| `puzzles/secure_treasury_vault.clsp` | Vault: one child, min-hold interest, announcement claim |
| `puzzles/secure_treasury_coin.clsp` | Treasury: one child remainder, assert vault claim |
| `PLAN.md` | Implementation checklist |

## Studio prompt (use this so Auto routes to ChiaLisp 14B)

```
Write secure ChiaLisp (.clsp) for a treasury-backed savings vault.
Fix the CircuitDAO-style bugs: no multi CREATE_COIN lineage spoof,
no same-block flash-loan interest, 32-byte puzzle hashes, treasury cover.
Start from templates/secure-treasury/ and produce puzzles + docs/MTT-style notes.
```

## Operator

On the worker: `cdv` + `clvm_tools` required. Prefer Coder 14B for this domain.
