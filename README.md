# Anvil

**DAT-paid AI coding agent** — AWS hosts the website; your ThinkStation P720 with an RTX 3090 runs the agent. Customers connect **Sage** and pay with **DAT** (Chia CAT) for credits.

## Architecture

```
Browser ──► Amplify (Next.js site + API)
                │
                ├── DynamoDB (credits, jobs)   [JSON file in local demo]
                │
                └── HTTPS claim/complete ◄── P720 worker ──► Ollama/vLLM (RTX 3090)
```

Diagram: [`docs/anvil-hybrid-architecture.drawio`](docs/anvil-hybrid-architecture.drawio)

### Hardware fit (your box)

| Piece | Role |
| --- | --- |
| P720 + RTX 3090 | Run the coding agent (Ollama / vLLM) |
| 16 GB system RAM | Start small models; upgrade RAM when you can |
| 2×1 TB NVMe | OS + hot models + workspaces |
| 16 TB HDD | Cold model archive, job artifacts, datasets |

AWS does **not** need your GPU. Keep inference on-prem to avoid GPU cloud bills.

## Quick start (this repo)

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

1. **Buy credits** — demo mode settles DAT packs without chain broadcast.
2. **Studio** — enqueue a coding job; the inline demo worker answers immediately.
3. **P720 worker** (optional while developing):

```bash
ANVIL_API_BASE=http://127.0.0.1:43127 \
WORKER_API_KEY=dev-worker-key-change-me \
DISABLE_INLINE_WORKER=1 \
npm run worker
```

On the workstation, point `ANVIL_API_BASE` at your Amplify URL and install Ollama:

```bash
ollama pull qwen2.5-coder:14b   # pick a size that fits VRAM after RAM upgrade
OLLAMA_MODEL=qwen2.5-coder:14b npm run worker
```

## DAT + Sage

- Default DAT asset id: `d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c` (DAT Governance Token CAT2). Override with `NEXT_PUBLIC_DAT_ASSET_ID` if you use a different DAT.
- Set `NEXT_PUBLIC_MERCHANT_XCH_ADDRESS` to the xch1 address that should receive DAT.
- Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from [WalletConnect Cloud](https://cloud.walletconnect.com/) to move from demo connect → live Sage WalletConnect. The payment UI already creates intents with memo + asset id for CAT spends.

## Deploy to AWS

### 1. Amplify Hosting (website)

1. Create an Amplify app from this repo (Next.js SSR).
2. Environment variables from `.env.example` (especially `WORKER_API_KEY`, merchant address, DAT asset id).
3. Optional: use `infra/amplify.yml` as the build spec.

### 2. DynamoDB (production store)

```bash
aws cloudformation deploy \
  --template-file infra/cloudformation.yml \
  --stack-name anvil \
  --parameter-overrides WorkerApiKey='replace-with-long-secret' \
  --capabilities CAPABILITY_NAMED_IAM
```

Local demo uses `.data/store.json`. Wire the Amplify app to DynamoDB when you leave demo mode (table + key layout are in the template).

### Cost sketch (dev traffic)

| Service | Typical monthly |
| --- | --- |
| Amplify Hosting (SSR, low traffic) | ~$5–20 |
| DynamoDB on-demand | usually &lt; $5 |
| Data transfer | small unless you stream large artifacts |
| RTX 3090 electricity | on your power bill |

No cloud GPU required for v1.

## API surface

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /api/session` | browser | create/load credit account |
| `POST /api/payments/intent` | browser | start DAT pack purchase |
| `POST /api/payments/confirm` | browser | credit after payment (demo or tx id) |
| `POST /api/jobs` | browser | enqueue coding job |
| `POST /api/worker/claim` | P720 | claim next job (`x-worker-key`) |
| `POST /api/worker/complete` | P720 | post result |

## Next upgrades (when you are ready)

- Live Sage CAT spend + on-chain receipt verification
- Persist to DynamoDB instead of `.data/store.json`
- Stream token output over SSE while the 3090 generates
- Add system RAM and larger quantized coder models
- Optional Site-to-Site VPN if you later move the worker behind a private API
