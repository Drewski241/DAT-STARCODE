# Secure treasury template (DAT STARCODER)

Minimal ChiaLisp patterns that encode fixes for the **CircuitDAO treasury / savings**
class of bugs (2025 Zellic finding + 2026 mainnet treasury drain).

| File | Role |
| --- | --- |
| `VULNERABILITY.md` | What broke and why |
| `puzzles/savings_vault.clsp` | Vault: one child per spend, min-hold interest, announcement |
| `puzzles/treasury_coin.clsp` | Treasury: one child remainder, assert vault claim |
| `docs/SECURITY.md` | Checklist |
| `PLAN.md` | Implementation checklist |

Legacy filenames `secure_treasury_vault.clsp` / `secure_treasury_coin.clsp` are superseded — use the names above.

## Studio prompt

```
Write secure ChiaLisp (.clsp) for a treasury-backed savings vault.
Fix CircuitDAO-style bugs: no multi CREATE_COIN lineage spoof,
no same-block flash-loan interest, 32-byte puzzle hashes, treasury cover.
Start from templates/secure-treasury/.
```

Auto routes this to **Coder 14B** + seeds these files into the workspace. Edit in place; do not invent a mega-file with multiple CREATE_COIN siblings.
