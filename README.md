# DAT STARCODER

**DAT-paid AI coding agent.** Customers connect **Sage**, burn **DAT** for credits, and use the studio. The public site stays product-focused; this README is for operators.

## Payments (burn)

Every credit purchase sends DAT to the official Chia **burn address** (unspendable forever):

`xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqm6ks6e8mvy`

Override with `NEXT_PUBLIC_DAT_BURN_ADDRESS` only if you intentionally use another destination (e.g. testnet).

### Slow-burn pricing (vs 150M supply)

See `src/lib/economy.ts`. Defaults:

- Allow at most **10% of supply** to be burned over **100 years** at continuous full load
- Assume **2,000 credits/day** full load
- That yields ≈ **4.87 credits per DAT** (≈ **0.205 DAT per credit**)
- Packs are priced in credits first; DAT cost is derived so the token cannot be drained quickly

At that pace, even nonstop max usage leaves ~90% of DAT unburned after a century.

## Architecture (operators)

```
Browser ──► Amplify (Next.js site + API)
                │
                ├── DynamoDB (credits, jobs)   [JSON file in local demo]
                ├── S3 (per-job customer workspaces)
                │
                └── HTTPS claim/complete ◄── on-prem worker ──► Ollama/vLLM
```

### Customer workspaces

Every job gets a working directory under `{accountId}/{jobId}`:

- **Local demo:** `.data/workspaces/...`
- **AWS:** S3 bucket from CloudFormation (`WORKSPACE_S3_BUCKET`)

The agent writes real files (parsed from `### File: path` code fences). In the studio, open the **Workspace** tab to browse files or **Download zip**.

Diagram: [`docs/anvil-hybrid-architecture.drawio`](docs/anvil-hybrid-architecture.drawio)

Keep inference on your workstation GPU so cloud GPU spend stays at zero.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:43127](http://localhost:43127).

1. **Sign in** at `/account` — DAT username / DAT password (shared DAT account), or create a new DAT STARCODER account. Password reset uses the shared DAT email reset flow.
2. **Buy credits (live Sage burn)** — set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, Connect Sage, then Burn DAT. Sage sends DAT to the Chia burn address; credits are granted after you approve the send.
3. **Studio** — create a **project**, pick a model, and send turns. Turns share one workspace; the worker runs a tool-using agent loop (list/read/write/run, plus web search, URL fetch, CLVM verify, and puzzle_hash via cdv). Progress and draft tokens stream live over SSE.
4. **GitHub (optional)** — set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` ([setup](docs/github-oauth-setup.md)), Connect GitHub in Studio, create/link a playground repo; the worker clones, branches, and opens a PR.
5. **Live worker** (GPU box):

```bash
DISABLE_INLINE_WORKER=1 npm run dev   # website terminal

DAT_STARCODER_API_BASE=http://localhost:43127 \
WORKER_API_KEY=dev-worker-key-change-me \
WORKER_ID=p720 \
OLLAMA_URL=http://127.0.0.1:11434 \
npm run worker
```

Pull the models you want users to select (Auto needs both a coder and a general model):

```bash
ollama pull qwen2.5-coder:7b
ollama pull llama3.1:8b
# optional (stronger coding — recommended for ChiaLisp / hard tasks):
# ollama pull qwen2.5-coder:14b
# ollama pull qwen2.5:7b
```

The worker **preflights** the selected Ollama tag before running (`ollama list`). If Studio picks `qwen2.5-coder:14b` and it is not pulled, the job fails immediately with pull instructions instead of burning agent steps.

**Credits (sticker price at enqueue):**

| Signal | Effect |
| --- | --- |
| Base | `CREDITS_PER_JOB` (default **5**) |
| Model `14b` | ×2 base |
| Model `32b` / `70b` | ×3 base |
| Hard domain (`.clsp` / ChiaLisp / `mtt_pool` / …) | +`CREDITS_HARD_DOMAIN` (default **10**) |

Example: Coder 14B + ChiaLisp prompt → **5×2+10 = 20** credits. Studio shows the live total on **Send turn**. Worker reports `stepsUsed` on complete (for future settle/refund).

**Niche domains:** prompts that mention `.clsp` / ChiaLisp load `worker/playbooks/chialisp.md` into the agent system prompt, raise the step budget (`AGENT_HARD_TASK_STEPS`, default **40**), and **verify** written `.clsp` files (must start with `(mod`, reject Common Lisp stubs). Failed verification is called out in the job result.

**Workspace deletes:** when the agent `rm`s a file that was pulled from Studio, the worker sends `deletePaths` on push so S3/local storage drops it (otherwise stubs lingered forever across turns).

**Goal router:** short prompts are classified (`mtt_pool` / `chialisp` / `coding` / `general`). Hard goals load playbooks under `worker/playbooks/`, require a `PLAN.md` first step, and enable the optional **`puzzle_hash`** tool (`cdv` on the worker).

**cdv (optional, worker box):**

```bash
pipx install chia-dev-tools   # provides `cdv`
cdv --help
# restart npm run worker
```

When `cdv` is present, ChiaLisp turns must document a 64-char puzzle hash (or verification fails).

**Auto** routing: hard domain (ChiaLisp / MTT) → `qwen2.5-coder:14b`; other coding → `qwen2.5-coder:7b`; otherwise → `llama3.1:8b`. Pull 14B on the worker or hard Auto jobs will 404 at preflight. Routing is re-evaluated when a job is claimed so queued jobs pick up heuristic fixes.

Optional worker agent knobs (see `.env.example`): `AGENT_MAX_STEPS`, `AGENT_ALLOW_SHELL`, `AGENT_REPO_ROOT`. Install `clvm_tools` (via `npm ci`) or put `brun`/`run` on `PATH` for ChiaLisp verification / `clvm_verify`.

If a worker dies mid-job, `claimed`/`running` jobs older than `STALE_JOB_CLAIM_MS` (default 45s) are reclaimed by the next worker poll. `GET /api/worker/queue` (worker key) dumps store vs sidecar queue state for debugging.

## DAT + Sage (live burns)

1. Create a free project at [WalletConnect Cloud](https://cloud.walletconnect.com/) and copy the **Project ID**.
2. Put it in `.env`:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

3. Restart `npm run dev`, sign in, open **Buy DAT credits**, click **Connect Sage**, scan the QR in Sage.
4. Choose a pack and **Burn DAT** — Sage prompts you to send DAT to the burn address. After you approve, credits are added.

- Default DAT asset id: `d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c` (DAT Governance Token CAT2).
- Burn destination: `xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqm6ks6e8mvy`
- Amounts use 3 DAT decimals (1 DAT = 1000 mojos). Optional XCH fee defaults to 0.0001 XCH.
- After Sage submits the burn, the API verifies the DAT coin on-chain (coinset.org) — matching burn CAT puzzle hash, amount, and payment memo — before credits are granted.
- Demo credits without a burn: set `ALLOW_DEMO_PAYMENTS=1` (off by default).

## Deploy to AWS

### 1. Amplify Hosting (website)

1. Create an Amplify app from this repo (Next.js SSR).
2. Environment variables from `.env.example` (`WORKER_API_KEY`, DAT asset id, burn address).
3. Optional: use `infra/amplify.yml` as the build spec.

### 2. DynamoDB + workspace S3

```bash
aws cloudformation deploy \
  --template-file infra/cloudformation.yml \
  --stack-name dat-starcoder \
  --parameter-overrides WorkerApiKey='replace-with-long-secret' \
  --capabilities CAPABILITY_NAMED_IAM
```

Then set Amplify env vars (from stack outputs):

| Variable | Value |
| --- | --- |
| `WORKER_API_KEY` | same secret as the stack parameter |
| `WORKSPACE_S3_BUCKET` | `WorkspaceBucketName` output (**required** — also persists accounts/sessions) |
| `AUTH_SECRET` | long random string (must be stable across deploys) |
| `COOKIE_DOMAIN` | `.datstarcoder.com` when using the custom domain (apex + www) |
| ~~`AWS_REGION`~~ | **Do not set** — Amplify reserves `AWS_*` and injects the region itself |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project id |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth App for Studio → Connect GitHub → worker PRs ([setup](docs/github-oauth-setup.md)) |
| `ALLOW_DEMO_PAYMENTS` | `1` only for invite-only tester credits |

**Amplify SSR must be able to call S3.** If `/api/worker/queue` reports `CredentialsProviderError`, the compute has no AWS credentials:

1. **Preferred:** Amplify console → App settings → **IAM roles** → create/attach an **SSR compute role** with `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on `arn:aws:s3:::dat-starcoder-workspaces-*` and `.../*`. Redeploy.
2. **Escape hatch** (Amplify forbids `AWS_*` env vars): set these Amplify env vars from an IAM user that can access the bucket, then redeploy:
   - `STARCODER_AWS_ACCESS_KEY_ID`
   - `STARCODER_AWS_SECRET_ACCESS_KEY`

Without `WORKSPACE_S3_BUCKET`, Amplify’s ephemeral disk cannot keep accounts — sign-in will look successful then bounce back to the login screen.

Local demo uses `.data/store.json` and `.data/workspaces/`. Wire Amplify to DynamoDB when you leave demo mode.

### Cost sketch (dev traffic / few testers)

| Service | Typical monthly |
| --- | --- |
| Amplify Hosting (SSR, low traffic) | ~$5–20 |
| DynamoDB on-demand | usually &lt; $5 |
| S3 workspaces | usually &lt; $1–3 |
| Data transfer | small unless you stream large artifacts |
| Local GPU electricity | on your power bill |

## API surface

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /api/session` | browser | create/load credit account |
| `POST /api/payments/intent` | browser | start DAT pack (burn destination) |
| `POST /api/payments/confirm` | browser | credit after burn (demo or tx id) |
| `GET/POST /api/projects` | browser | list / create persistent projects |
| `GET /api/projects/:id` | browser | project + its turns |
| `POST /api/jobs` | browser | enqueue a turn (`projectId` shares workspace) |
| `GET /api/jobs/:id/stream` | browser | SSE live tool/token progress for a turn |
| `POST /api/worker/workspace` | worker | pull/push workspace files for the agent loop |
| `POST /api/worker/progress` | worker | push tool/token events (`x-worker-key`) |
| `GET /api/jobs/:id/workspace` | browser | list workspace files |
| `GET /api/jobs/:id/workspace/file?path=` | browser | read one file |
| `GET /api/jobs/:id/workspace/download` | browser | zip download |
| `POST /api/worker/claim` | worker | claim next job (`x-worker-key`) |
| `GET /api/worker/queue` | worker | debug store vs sidecar queue snapshot |
| `POST /api/worker/complete` | worker | post result (+ materialize files) |

## Next upgrades

- Persist to DynamoDB instead of `.data/store.json` (S3 JSON store is the Amplify default today)
