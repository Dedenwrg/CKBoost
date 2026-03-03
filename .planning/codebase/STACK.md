# Technology Stack

**Analysis Date:** 2026-03-03

## Languages

**Primary:**
- TypeScript 5.x - Main dApp and SDK code in `dapp/` and `packages/ssri-ckboost/src/`
- Rust (edition 2021) - On-chain contracts and validation logic in `contracts/contracts/*/src/` and shared libs in `contracts/libs/ckboost-shared/src/`

**Secondary:**
- JavaScript (ESM + CJS) - Next.js/Jest/Netlify config and scripts in `dapp/*.mjs`, `dapp/jest.config.js`, `packages/ssri-ckboost/jest.config.js`
- Bash - Deployment and environment automation in `scripts/deployment/*.sh`, test helpers like `jest-runner.sh`

## Runtime

**Environment:**
- Node.js 18+ required for frontend workflow (documented in `README.md`)
- Browser runtime for React app (`dapp/app/*`, `dapp/components/*`)
- CKB VM runtime for Rust contracts built from `contracts/contracts/*`

**Package Manager:**
- `pnpm` for dApp and workspace workflows (`dapp/package.json`, `dapp/pnpm-lock.yaml`, `dapp/pnpm-workspace.yaml`)
- `npm`/`npx` used in SDK generation/build steps (`packages/ssri-ckboost/package.json`, `packages/ssri-ckboost/package-lock.json`)
- Cargo for Rust workspace (`contracts/Cargo.toml`, `contracts/Cargo.lock`)

## Frameworks

**Core:**
- Next.js `15.5.9` + React `19.2.0` for UI and routing (`dapp/package.json`, `dapp/app/`)
- Netlify Functions for serverless APIs (`dapp/netlify/functions/*.ts`)
- CKB CCC stack (`@ckb-ccc/connector-react`, `@ckb-ccc/core`, `@ckb-ccc/ssri`) for blockchain client and transaction building (`dapp/package.json`, `packages/ssri-ckboost/package.json`)
- `ckb-std`, `ckb-ssri-std`, `ckb_deterministic` for on-chain Rust contract logic (`contracts/contracts/*/Cargo.toml`, `contracts/libs/ckboost-shared/Cargo.toml`)

**Testing:**
- Jest 29 for dApp and SDK (`dapp/jest.config.js`, `packages/ssri-ckboost/jest.config.js`)
- `@testing-library/react` for dApp component tests (`dapp/package.json`)
- Rust test harness via `ckb-testtool` for contract integration tests (`contracts/tests/Cargo.toml`)

**Build/Dev:**
- TypeScript compiler (`tsc`) in SDK build (`packages/ssri-ckboost/package.json`)
- Molecule code generation (`moleculec` + `scripts/generate-types.ts`) for schema-driven types (`packages/ssri-ckboost/scripts/generate-types.ts`, `schemas/ckboost.mol`)
- Netlify plugin for Next.js deployment (`netlify.toml`, `dapp/netlify.toml`)

## Key Dependencies

**Critical:**
- `ssri-ckboost` (local file dependency) - Shared SDK used by dApp services (`dapp/package.json`, `packages/ssri-ckboost/src/index.ts`)
- `@ckb-ccc/connector-react` / `@ckb-ccc/shell` - Wallet and chain client integration (`dapp/package.json`)
- `@nostrify/*` + `nostr-tools` - Off-chain submission/comment storage and relay access (`dapp/lib/providers/nostr-provider.tsx`, `dapp/netlify/functions/social-interactions.ts`)
- `@telegram-auth/server` + `@telegram-auth/react` - Telegram verification flow (`dapp/netlify/functions/telegram-authenticate.ts`, `dapp/package.json`)
- `zod` - Runtime validation surfaces across services/functions (`dapp/package.json`)

**Infrastructure:**
- Netlify runtime package `@netlify/functions` for function handlers (`dapp/package.json`, `dapp/netlify/functions/*.ts`)
- Rust dependencies in `ckboost-shared` for script validation/classification (`contracts/libs/ckboost-shared/src/*.rs`)

## Configuration

**Environment:**
- Root env template for chain/deployment setup in `.env.example`
- dApp runtime env consumed from `process.env.*` in services/providers (`dapp/lib/services/*.ts`, `dapp/lib/providers/pending-transaction-provider.tsx`)
- Contract deployment records in `deployments.json` and guidance in `deployment-summary.md`

**Build:**
- Next.js config in `dapp/next.config.mjs`
- TypeScript configs in `dapp/tsconfig.json`, `packages/ssri-ckboost/tsconfig.json`
- Rust workspace and per-contract Cargo manifests in `contracts/Cargo.toml`, `contracts/contracts/*/Cargo.toml`

## Platform Requirements

**Development:**
- macOS/Linux-compatible shell scripts (`scripts/deployment/*.sh`, `dapp/scripts/install-build-tools.sh`)
- Node + pnpm for dApp/SDK workflows
- Rust toolchain for contract compilation/tests
- CKB RPC access (`NEXT_PUBLIC_CKB_RPC_URL`, defaults in services and scripts)

**Production:**
- Netlify-hosted Next.js site + Netlify functions (`dapp/netlify.toml`)
- CKB testnet/mainnet endpoints and deployed contract hashes (`deployments.json`, `dapp/lib/ckb/deployment-manager.ts`)

---

*Stack analysis: 2026-03-03*
*Update after major dependency changes*
