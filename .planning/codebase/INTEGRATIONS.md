# External Integrations

**Analysis Date:** 2026-03-03

## APIs & External Services

**Blockchain RPC / Indexing:**
- CKB RPC endpoints - Core on-chain read/write flow for protocol, campaign, user, tipping operations
  - SDK/Client: `@ckb-ccc/connector-react` and `@ckb-ccc/shell`
  - Auth: none at app layer (public RPC endpoints)
  - Endpoints used: JSON-RPC methods like `get_transaction`, chain cell scans (`dapp/lib/providers/pending-transaction-provider.tsx`, `dapp/lib/ckb/*.ts`)

**SSRI Executor Service:**
- SSRI JSON-RPC executor - Builds/validates contract transactions off-chain before signing
  - SDK/Client: `ssri.ExecutorJsonRpc`
  - Auth: URL-based endpoint via `NEXT_PUBLIC_SSRI_EXECUTOR_URL`
  - Methods used: contract trait calls such as `CKBoostProtocol.update_protocol` (`dapp/lib/services/protocol-service.ts`, `packages/ssri-ckboost/src/protocol/index.ts`)

**Nostr Network:**
- Nostr relays - Quest submissions, social comments/likes metadata
  - Integration method: websocket relay pool and event fetch/publish
  - Relays: defaults include `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`, `wss://relay.primal.net`
  - Locations: `dapp/lib/providers/nostr-provider.tsx`, `dapp/hooks/use-nostr-fetch.ts`, `dapp/netlify/functions/social-interactions.ts`

**Telegram API Verification:**
- Telegram login verification - identity proof flow
  - SDK/Client: `@telegram-auth/server`, `@telegram-auth/react`
  - Auth: `TELEGRAM_BOT_TOKEN`
  - Endpoint used: Netlify function `dapp/netlify/functions/telegram-authenticate.ts`

## Data Storage

**Databases:**
- No traditional SQL/NoSQL DB in this repo
- Canonical state is stored on-chain in CKB cells (protocol, campaign, user, tipping, funding)

**File Storage:**
- Repository file-based deployment records and docs (`deployments.json`, `deployment-summary.md`, `docs/`)

**Caching:**
- Browser localStorage for pending transaction tracking (`dapp/lib/providers/pending-transaction-provider.tsx`)
- In-memory caches inside serverless functions for social aggregation (`dapp/netlify/functions/social-interactions.ts`)

## Authentication & Identity

**Auth Provider:**
- Wallet-based identity via CKB signer objects and lock hashes
  - Implementation: CCC signer and client types in dApp services
  - Session/token: wallet session in client environment, no centralized auth session service in repo

**Verification Integrations:**
- Telegram verification bound to user cell verification data (`dapp/netlify/functions/telegram-authenticate.ts`)
- Proxy/admin verification helper paths in Netlify libs (`dapp/netlify/lib/proxy-admin.ts`, `dapp/netlify/lib/user-data.ts`)

## Monitoring & Observability

**Error Tracking:**
- No Sentry/DataDog integration detected in source
- Application logging via scoped logger wrappers (`packages/ssri-ckboost/src/logging/index.ts`, `dapp/netlify/lib/log.ts`)

**Analytics:**
- No dedicated analytics SaaS integration found

**Logs:**
- Console/stdout logs in browser/serverless/Node scripts
- On-chain debug traces in Rust contracts via `ckb_deterministic::debug_trace`

## CI/CD & Deployment

**Hosting:**
- Netlify for dApp + serverless functions (`dapp/netlify.toml`, root `netlify.toml`)
  - Deployment plugin: `@netlify/plugin-nextjs`
  - Redirect rules map `/api/*` to Netlify functions

**CI Pipeline:**
- GitHub Actions present for Claude automation and PR review, not full test/build gating (`.github/workflows/claude.yml`, `.github/workflows/claude-code-review.yml`)

## Environment Configuration

**Development:**
- Key vars include `NEXT_PUBLIC_CKB_RPC_URL`, `NEXT_PUBLIC_PROTOCOL_TYPE_ARGS`, `NEXT_PUBLIC_SSRI_EXECUTOR_URL`, `TELEGRAM_BOT_TOKEN`, `NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY`
- Env templates/guides: `.env.example`, `deployment-summary.md`, `scripts/deployment/update-env.sh`

**Staging:**
- No dedicated staging config files found; environment appears Netlify-dashboard driven

**Production:**
- Secrets expected in Netlify/GitHub secret stores and local `.env` files (gitignored)
- Deployment metadata source-of-truth in `deployments.json`

## Webhooks & Callbacks

**Incoming:**
- HTTP callbacks into Netlify functions under `dapp/netlify/functions/`
- Primary function entrypoints include `telegram-authenticate`, `social-interactions`, `staff-approve-submissions`, `streakBonus-*`, `achievement-*`

**Outgoing:**
- Outbound RPC calls to CKB endpoints and SSRI executor from services/functions
- Outbound websocket/event calls to Nostr relays
- Outbound Telegram validation logic in auth function

---

*Integration audit: 2026-03-03*
*Update when external services change*
