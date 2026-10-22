# DAT STARCODER playground

Seed repo for end-to-end tests: connect GitHub in Studio, link this repo to a
project, send a turn, and confirm the worker opens a pull request.

## Create on GitHub (manual)

```bash
# empty repo on github.com, then:
gh repo create dat-starcoder-playground --public --source=. --remote=origin --push
```

Or use **Studio → Create playground repo** (preferred) which creates
`dat-starcoder-playground` on your account and links it automatically.

## First prompt ideas

- Scaffold TypeScript CLI with tests and README
- Add a small Express/Fastify HTTP API
- Build a static game under `public/` and document How to run

## What the worker does

1. Clones this repo into the job workspace  
2. Runs the tool agent (list / read / write / run)  
3. Commits on `dat-starcoder/<jobId>`  
4. Opens a PR against the default branch  
