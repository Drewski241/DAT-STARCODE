# GitHub OAuth setup (DAT STARCODER)

## 1. Create the OAuth App

1. GitHub → Settings → Developer settings → **OAuth Apps** → New  
2. Application name: `DAT STARCODER`  
3. Homepage: `https://datstarcoder.com`  
4. Authorization callback URL: `https://datstarcoder.com/api/github/callback`  
5. Copy **Client ID** and generate a **Client secret**

## 2. Amplify env vars

| Name | Value |
| --- | --- |
| `GITHUB_CLIENT_ID` | from the OAuth App |
| `GITHUB_CLIENT_SECRET` | from the OAuth App |
| `GITHUB_REDIRECT_URI` | `https://datstarcoder.com/api/github/callback` (optional if origin matches) |

Redeploy the Amplify branch after saving (GitHub push or Redeploy).

## 3. Test flow on your account

1. Sign in at `/studio`  
2. **Connect GitHub** → authorize `repo` + `read:user`  
3. **Create playground repo** (or pick an existing repo)  
4. Send a turn that edits files  
5. Confirm a PR appears on GitHub and the Studio job shows **Open pull request**

## Scopes

Requested: `repo read:user` — needed to push branches and open PRs on private and public repos you can access.
