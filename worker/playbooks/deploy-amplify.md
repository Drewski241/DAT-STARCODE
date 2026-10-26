# Deploy / Amplify skill pack

User is shipping the Next.js site (or asking why Amplify is stale).

## Facts for this product

- Amplify watches GitHub branch `cursor/customer-workspaces-18de`.
- Origin is source of truth; after merge, push that branch to `github`.
- Worker and Amplify share the same P720 checkout (`~/DAT-STARCODE`).

## Safe steps

1. Confirm branch: `git branch --show-current` should be `cursor/customer-workspaces-18de` (or merge into it).
2. `git fetch origin && git pull origin cursor/customer-workspaces-18de`
3. `git push origin cursor/customer-workspaces-18de`
4. `git push github cursor/customer-workspaces-18de`
5. Restart the worker process after pulling agent changes.
6. Never invent Amplify console secrets; point at `.env.example` keys only.

## Done when

- User has the exact push commands and knows to wait for Amplify build + worker restart.
