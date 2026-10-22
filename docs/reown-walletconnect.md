# Reown (WalletConnect) for Sage burns

## Amplify

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | From [dashboard.reown.com](https://dashboard.reown.com/) → your project → Project ID. Must be present at **build** time (it is inlined into the browser bundle). |

After changing it, redeploy the Amplify branch (push to `cursor/customer-workspaces-18de` on GitHub).

## Reown allowlist (most common timeout cause)

Dashboard → Project → **Domains / Allowlist** — add:

- `https://datstarcoder.com`
- `https://www.datstarcoder.com`

Updates can take ~15 minutes. Empty allowlist = all origins allowed; a partial list will deny others.

## If Connect Sage times out on the relay

1. Confirm the pay page footer shows a project fingerprint like `466f…3ec2` (proves Amplify baked the id).
2. Confirm allowlist includes the exact origin in the address bar.
3. Try phone hotspot / disable VPN and adblock for `relay.walletconnect.com`.
4. DevTools → Network → WS: look for `relay.walletconnect.com` (or `.org`) and note status (401/403 vs pending).
