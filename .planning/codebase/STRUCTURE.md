# Codebase Structure

**Analysis Date:** 2026-03-03

## Directory Layout

```
CKBoost/
├── contracts/              # Rust smart contracts and integration tests
├── dapp/                   # Next.js app + Netlify serverless functions
├── docs/                   # Product/architecture/deployment documentation
├── packages/               # Shared TypeScript SDK package(s)
├── schemas/                # Molecule schema definitions
├── scripts/                # Deployment and debugging scripts
├── deployments.json        # Deployed contract metadata by network
├── netlify.toml            # Root Netlify plugin/function config
└── README.md               # Project overview and onboarding
```

## Directory Purposes

**`dapp/`:**
- Purpose: User/admin frontend and serverless APIs
- Contains: `app/`, `components/`, `lib/`, `netlify/functions/`, docs content for Nextra
- Key files: `dapp/package.json`, `dapp/netlify.toml`, `dapp/next.config.mjs`
- Subdirectories: `lib/services/` (domain logic), `lib/ckb/` (chain access), `lib/providers/` (global state)

**`contracts/`:**
- Purpose: On-chain protocol/campaign/user/funding/tipping/achievement logic
- Contains: individual crates under `contracts/contracts/*`, shared library under `contracts/libs/ckboost-shared`, integration tests under `contracts/tests`
- Key files: `contracts/Cargo.toml`, `contracts/tests/src/lib.rs`
- Subdirectories: each contract crate has `main.rs`, `modules.rs`, `recipes.rs`, `fallback.rs`, `ssri.rs`

**`packages/ssri-ckboost/`:**
- Purpose: Shared TS SDK for encoding/trait calls/logging consumed by dApp
- Contains: source traits/types, generated molecule types, jest tests/scripts
- Key files: `packages/ssri-ckboost/src/index.ts`, `packages/ssri-ckboost/src/generated/ckboost.ts`, `packages/ssri-ckboost/package.json`
- Subdirectories: `src/protocol/`, `src/campaign/`, `src/user/`, `src/tipping/`, `src/achievement/`

**`docs/`:**
- Purpose: Architecture, proposals, deployment guides, milestones, recipe examples
- Contains: markdown docs and assets
- Key files: `docs/contract-architecture.md`, `docs/integration-architecture.md`, `docs/protocol-deployment-guide.md`

**`scripts/`:**
- Purpose: Operational tooling for deployment and debugging
- Contains: `scripts/deployment/*`, `scripts/debugger/*`
- Key files: `scripts/deployment/deploy-contracts.sh`, `scripts/deployment/update-env.sh`, `scripts/debugger/debug-tx.ts`

## Key File Locations

**Entry Points:**
- `dapp/app/page.tsx`: main frontend landing route
- `dapp/netlify/functions/*.ts`: HTTP serverless handlers
- `contracts/contracts/*/src/main.rs`: contract execution entrypoints

**Configuration:**
- `.env.example`: root environment variable template
- `dapp/next.config.mjs`: Next.js build/runtime config
- `dapp/tsconfig.json`: dApp TS config and aliases (`@/*`, `ssri-ckboost`)
- `contracts/Cargo.toml`: Rust workspace manifest
- `deployments.json`: chain deployment addresses/hashes

**Core Logic:**
- `dapp/lib/services/`: domain operations and orchestration
- `dapp/lib/ckb/`: chain cell querying and tx utility logic
- `packages/ssri-ckboost/src/*`: trait-level SDK methods
- `contracts/contracts/*/src/modules.rs`: contract business rule implementations

**Testing:**
- `dapp/jest.config.js` and app tests under `dapp/**/*.test.*`
- `packages/ssri-ckboost/src/protocol/protocol.simple.test.ts`
- `contracts/tests/src/*.rs` for Rust integration tests

**Documentation:**
- `README.md` for overview/onboarding
- `docs/` for deeper design/deployment references
- `packages/ssri-ckboost/DEBUG_SETUP.md` and `DEBUG_QUICKSTART.md` for SDK testing/debugging

## Naming Conventions

**Files:**
- Kebab-case common for TS modules and React utility components (for example `campaign-admin-service.ts`, `pending-transaction-provider.tsx`)
- Next.js route conventions use framework filenames (`page.tsx`, `loading.tsx`)
- Rust files follow module naming (`main.rs`, `modules.rs`, `recipes.rs`, `fallback.rs`)

**Directories:**
- Feature/domain grouping by plural nouns (`services/`, `providers/`, `functions/`, `contracts/`)
- Contract crates use `ckboost-<domain>-<type|lock|udt>` naming

**Special Patterns:**
- `index.ts` barrel exports across SDK and utility directories
- Generated molecule artifacts under `packages/ssri-ckboost/src/generated/`
- `.ignore` suffix is used on disabled tests (`protocol.test.ts.ignore`, `protocol.integration.test.ts.ignore`)

## Where to Add New Code

**New dApp Feature:**
- Primary code: `dapp/app/<route>/` and/or `dapp/components/`
- Service logic: `dapp/lib/services/`
- Chain integration: `dapp/lib/ckb/`
- Tests: colocated `*.test.ts(x)` or relevant service/provider test file

**New Contract Capability:**
- Implementation: target crate in `contracts/contracts/ckboost-*/src/modules.rs`
- Validation rules: corresponding `recipes.rs` and `fallback.rs`
- Shared data types/helpers: `contracts/libs/ckboost-shared/src/`
- Tests: `contracts/tests/src/`

**New Serverless Endpoint:**
- Handler: `dapp/netlify/functions/<name>.ts`
- Shared helpers: `dapp/netlify/lib/`
- Route mapping: `dapp/netlify.toml` redirects section

**Utilities:**
- dApp shared helpers: `dapp/lib/utils/`
- SDK helpers: `packages/ssri-ckboost/src/utils/`

## Special Directories

**`packages/ssri-ckboost/src/generated/`:**
- Purpose: Auto-generated molecule codec/types
- Source: `schemas/ckboost.mol` + `packages/ssri-ckboost/scripts/generate-types.ts`
- Committed: Yes

**`dapp/.next/` (generated during builds):**
- Purpose: Next.js build outputs
- Source: `next build` / `next dev`
- Committed: No

**`.taskmaster/`:**
- Purpose: task/report metadata
- Source: tooling workflow
- Committed: Yes in this repo snapshot

---

*Structure analysis: 2026-03-03*
*Update when directory structure changes*
