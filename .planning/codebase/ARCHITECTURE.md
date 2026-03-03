# Architecture

**Analysis Date:** 2026-03-03

## Pattern Overview

**Overall:** Full-stack dApp + serverless API + on-chain smart-contract system with a shared TypeScript SDK

**Key Characteristics:**
- Multi-package repository with clear separation between UI (`dapp/`), contracts (`contracts/`), and SDK (`packages/ssri-ckboost/`)
- Domain services in dApp call shared SDK traits, which in turn call SSRI executor and CKB RPC
- On-chain CKB cells are canonical state; off-chain Nostr + serverless support non-critical metadata and workflow helpers
- Contract registry/lookup pattern centered on protocol cell and `deployments.json`

## Layers

**Presentation Layer (UI):**
- Purpose: Pages, forms, dashboards, and user interactions
- Contains: Next.js app router pages and reusable React components (`dapp/app/`, `dapp/components/`)
- Depends on: service layer, hooks/providers, shared types
- Used by: end users, admins, campaign staff

**Application Service Layer:**
- Purpose: Business workflows for protocol/campaign/user/tipping/achievement actions
- Contains: service classes and orchestrators (`dapp/lib/services/*.ts`)
- Depends on: SDK (`ssri-ckboost`), blockchain cell helpers (`dapp/lib/ckb/*.ts`), utilities
- Used by: page components and hooks

**Data Access / Integration Layer:**
- Purpose: Chain queries, tx assembly, submission storage integration
- Contains: `dapp/lib/ckb/*.ts`, Nostr hooks/providers, pending tx tracker
- Depends on: CKB CCC libs, Nostr libs, env config
- Used by: service layer and serverless handlers

**Serverless Operations Layer:**
- Purpose: Verification, social interactions, approval/aggregation APIs
- Contains: Netlify function handlers (`dapp/netlify/functions/*.ts`) and helper libs (`dapp/netlify/lib/*.ts`)
- Depends on: CKB clients, Nostr, Telegram auth libs
- Used by: frontend API calls and admin workflows

**On-Chain Contract Layer:**
- Purpose: Deterministic validation and state transition rules
- Contains: contract crates under `contracts/contracts/*/src/` and shared primitives under `contracts/libs/ckboost-shared/src/`
- Depends on: ckb-std/ssri std/deterministic toolchain
- Used by: SSRI executor + chain runtime

## Data Flow

**User/Campaign Mutation Flow:**
1. UI action in `dapp/app/*` or `dapp/components/*` triggers service method.
2. Service (for example `dapp/lib/services/campaign-admin-service.ts`) builds domain payload.
3. Service/SDK calls SSRI executor method (for example `CKBoostCampaign.update_campaign`) via `packages/ssri-ckboost/src/*` trait class.
4. Transaction is completed/signed with CCC signer and submitted to CKB RPC.
5. Pending tx provider tracks status and updates UI once confirmed.

**Read/Query Flow:**
1. UI/hook invokes service fetch APIs.
2. Cell helpers in `dapp/lib/ckb/` query by script hashes/args.
3. Molecule data is decoded through generated/shared types (`packages/ssri-ckboost/src/generated/`, `packages/ssri-ckboost/src/types.ts`).
4. UI renders normalized models and derived metrics.

**State Management:**
- Client-managed state via React hooks/context providers (`dapp/lib/providers/*`)
- Pending tx lifecycle persisted in localStorage (`dapp/lib/providers/pending-transaction-provider.tsx`)
- No centralized DB-backed application state layer in repo

## Key Abstractions

**Service Classes:**
- Purpose: Domain boundaries and workflow orchestration
- Examples: `ProtocolService`, `CampaignService`, `UserService`, `TippingService`
- Pattern: OO service wrappers with explicit async operations and typed inputs

**Contract Trait Wrappers (SDK):**
- Purpose: Typed API over SSRI contract methods and molecule encoding
- Examples: `Protocol`, `Campaign`, `User`, `Tipping`, `Achievement` in `packages/ssri-ckboost/src/*`
- Pattern: class per trait + method-path based calls

**Recipe/Validation Modules (Rust):**
- Purpose: Enforce transaction invariants and fallback validation
- Examples: `recipes.rs`, `modules.rs`, `fallback.rs` in each contract crate
- Pattern: method dispatch + deterministic recipe checks

## Entry Points

**Web App:**
- Location: `dapp/app/page.tsx` and route segments under `dapp/app/`
- Triggers: browser requests via Next.js App Router
- Responsibilities: render user/admin flows and invoke services

**Serverless APIs:**
- Location: `dapp/netlify/functions/*.ts`
- Triggers: HTTP requests through Netlify redirects
- Responsibilities: Telegram verification, social interaction APIs, stats/approval helpers

**Contract Execution:**
- Location: `contracts/contracts/*/src/main.rs`
- Triggers: CKB VM script execution and SSRI method calls
- Responsibilities: validate tx shape/rules and produce deterministic outcomes

**Deployment Tooling:**
- Location: `scripts/deployment/deploy-contracts.sh`, `scripts/deployment/update-env.sh`
- Triggers: operator/dev script execution
- Responsibilities: deploy contracts and propagate env/deployment metadata

## Error Handling

**Strategy:** Boundary-level try/catch with contextual logging and explicit throw semantics

**Patterns:**
- Service methods throw descriptive errors for missing deployment/env/script dependencies
- Utility wrappers classify retryable vs non-retryable faults (`dapp/lib/utils/ssri-error-handler.ts`)
- Rust contract errors mapped to explicit error enums in `contracts/libs/ckboost-shared/src/error.rs`

## Cross-Cutting Concerns

**Logging:**
- Scoped logger abstraction used in dApp/SDK (`createScopedLogger`)
- Netlify function-specific logger wrappers in `dapp/netlify/lib/log.ts`

**Validation:**
- Input/field restriction checks in serverless layer (`ensureFieldRestrictions` and related helpers)
- Type-level validation via TypeScript types and molecule schema decoding

**Authentication:**
- Wallet signatures/lock hashes for chain operations
- Telegram verification flow for anti-sybil identity fields

---

*Architecture analysis: 2026-03-03*
*Update when major patterns change*
