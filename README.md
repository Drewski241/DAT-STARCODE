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
                │
                └── HTTPS claim/complete ◄── on-prem worker ──► Ollama/vLLM
```

Diagram: [`docs/anvil-hybrid-architecture.drawio`](docs/anvil-hybrid-architecture.drawio)

Keep inference on your workstation GPU so cloud GPU spend stays at zero.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

1. **Buy credits** — demo mode credits without broadcasting a burn.
2. **Studio** — enqueue a coding job; the inline demo worker answers immediately.
3. **Live worker** (optional while developing):

```bash
DAT_STARCODER_API_BASE=http://127.0.0.1:43127 \
WORKER_API_KEY=dev-worker-key-change-me \
DISABLE_INLINE_WORKER=1 \
npm run worker
```

With Ollama on the box:

```bash
ollama pull qwen2.5-coder:14b
OLLAMA_MODEL=qwen2.5-coder:14b npm run worker
```

## DAT + Sage

- Default DAT asset id: `d12fbf63bb015fa0e988509b971ad4c9da7cc5fc30f2499d3aab38c3fadc531c` (DAT Governance Token CAT2).
- Settlement destination defaults to the Chia burn address above.
- Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from [WalletConnect Cloud](https://cloud.walletconnect.com/) for live Sage. Payment intents already include memo + asset id for CAT spends to the burn address.

## Deploy to AWS

### 1. Amplify Hosting (website)

1. Create an Amplify app from this repo (Next.js SSR).
2. Environment variables from `.env.example` (`WORKER_API_KEY`, DAT asset id, burn address).
3. Optional: use `infra/amplify.yml` as the build spec.

### 2. DynamoDB (production store)

```bash
aws cloudformation deploy \
  --template-file infra/cloudformation.yml \
  --stack-name dat-starcoder \
  --parameter-overrides WorkerApiKey='replace-with-long-secret' \
  --capabilities CAPABILITY_NAMED_IAM
```

Local demo uses `.data/store.json`. Wire Amplify to DynamoDB when you leave demo mode.

### Cost sketch (dev traffic)

| Service | Typical monthly |
| --- | --- |
| Amplify Hosting (SSR, low traffic) | ~$5–20 |
| DynamoDB on-demand | usually &lt; $5 |
| Data transfer | small unless you stream large artifacts |
| Local GPU electricity | on your power bill |

## API surface

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /api/session` | browser | create/load credit account |
| `POST /api/payments/intent` | browser | start DAT pack (burn destination) |
| `POST /api/payments/confirm` | browser | credit after burn (demo or tx id) |
| `POST /api/jobs` | browser | enqueue coding job |
| `POST /api/worker/claim` | worker | claim next job (`x-worker-key`) |
| `POST /api/worker/complete` | worker | post result |

## Next upgrades

- Live Sage CAT spend to the burn address + on-chain receipt verification
- Persist to DynamoDB instead of `.data/store.json`
- Stream token output over SSE while the worker generates
