# Production / runtime log skill pack

User pasted deploy, Amplify, WalletConnect, or worker errors.

## Loop

1. Classify with error-fix (deps, Next build, env, WC, timeout).
2. Prefer `str_replace` / minimal config fixes — do not rewrite the app.
3. Re-run the failing command (`npm run build`, worker claim, etc.).
4. If env-related, cite exact Amplify / `.env` key names from `.env.example` — never invent secret values.

## Common

| Symptom | Action |
| --- | --- |
| CredentialsProviderError / S3 | SSR compute role / workspace bucket docs |
| WalletConnect offline | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` + Reown allowlist |
| Worker 401 | `WORKER_API_KEY` mismatch |
| Gtk / xdg-open | benign — use Studio Preview / screenshot_url |

## Done when

Failing command exits 0, or blocker + exact next command is clear.
