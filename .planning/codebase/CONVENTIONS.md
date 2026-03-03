# Coding Conventions

**Analysis Date:** 2026-03-03

## Naming Patterns

**Files:**
- TypeScript modules generally use kebab-case (`protocol-service.ts`, `pending-transaction-provider.tsx`)
- Next.js route files use framework names (`page.tsx`, `loading.tsx`)
- Rust contract module files are standardized (`main.rs`, `modules.rs`, `recipes.rs`, `fallback.rs`, `ssri.rs`)
- Tests commonly use `*.test.ts` / `*.simple.test.ts` (with some disabled `*.ignore` files)

**Functions:**
- camelCase naming for functions/methods (`fetchProtocolCell`, `updateProtocol`, `formatSSRIError`)
- Handler-style names in serverless modules (`handler`, helper methods like `parseInteraction`)
- Rust function names use snake_case per ecosystem conventions (`program_entry_wrap`, `update_protocol`)

**Variables:**
- camelCase for local variables and class fields
- UPPER_SNAKE_CASE for constants (`DEFAULT_RPC_URL`, `CKBOOST_SUBMISSION_KIND`)
- Type aliases/interfaces use PascalCase (`PendingTransactionRecord`, `SSRIErrorDetails`)

**Types:**
- TypeScript interfaces/types are PascalCase and explicit (`ProtocolTransaction`, `InteractionPayload`)
- Rust enums/structs use PascalCase, variants and fields follow Rust idioms

## Code Style

**Formatting:**
- TypeScript style is consistent with semicolons enabled
- String quote usage is mixed (double quotes dominant in dApp/service files; single quotes in some config/provider files)
- Rust formatting follows `rustfmt`-compatible style

**Linting:**
- dApp uses Next lint command (`dapp/package.json`)
- SDK uses ESLint (`packages/ssri-ckboost/package.json`)
- Notable: dApp `next.config.mjs` sets `ignoreDuringBuilds: true` and `ignoreBuildErrors: true`, so CI/build may not block on lint/type issues

## Import Organization

**Order:**
1. External packages first (`@ckb-ccc/*`, `react`, `nostr-tools`)
2. Internal aliases (`@/lib/...`) second
3. Relative imports last (`../`, `./`)

**Grouping:**
- Most files keep grouped imports with minimal inline require usage
- Type imports are used where useful (`import type { Handler } from "@netlify/functions"`)

**Path Aliases:**
- dApp alias `@/*` maps to project root of `dapp/` (`dapp/tsconfig.json`)
- SDK dist aliases `ssri-ckboost` and `ssri-ckboost/*` are configured in dApp tsconfig

## Error Handling

**Patterns:**
- Service layer throws explicit errors when prerequisites are missing (deployment, signer, protocol cell)
- try/catch wraps external IO boundaries (RPC, executor, Netlify handler parsing)
- Utility-level classification for retry behavior in `dapp/lib/utils/ssri-error-handler.ts`

**Error Types:**
- TypeScript mostly uses `Error` with contextual messages and logger metadata
- Rust contracts use explicit shared error enum (`contracts/libs/ckboost-shared/src/error.rs`)

## Logging

**Framework:**
- Centralized scoped logger in SDK (`packages/ssri-ckboost/src/logging/index.ts`)
- Netlify logger wrapper in `dapp/netlify/lib/log.ts`

**Patterns:**
- Structured metadata objects are frequently logged for tx hashes, params, and failure contexts
- Logging is concentrated at service boundaries and function handlers

## Comments

**When to Comment:**
- Comments are used to document blockchain-specific constraints, protocol rules, and operational rationale
- TODO comments mark unfinished test cases and not-yet-implemented validation sections

**JSDoc/TSDoc:**
- Public service/SDK methods often have descriptive JSDoc blocks
- Rust docs/comments explain protocol-level invariants and fallback behavior

**TODO Comments:**
- Pattern: plain `TODO:` comments without strict issue-ID linkage
- Significant TODO clusters exist in contract test files (`contracts/tests/src/test_*.rs`)

## Function Design

**Size:**
- Service and serverless handler files often contain large multi-step functions for transaction orchestration
- Helpers are extracted in utility modules for reusable logic (for example Nostr parsing and pending tx helpers)

**Parameters:**
- Domain methods use typed payload objects and explicit optional args where needed
- Async flows pass signer/client/context objects explicitly

**Return Values:**
- Async methods return typed Promises; failures are thrown rather than hidden
- Service APIs often return normalized domain objects or raw chain artifacts depending on use case

## Module Design

**Exports:**
- Named exports are common for utilities/services
- Barrel/index exports used for SDK package surface (`packages/ssri-ckboost/src/index.ts`, `src/barrel.ts`)

**Organization:**
- Domain-oriented module decomposition (protocol/campaign/tipping/user/achievement)
- dApp separates concerns into `services`, `ckb`, `providers`, `hooks`, `utils`

---

*Convention analysis: 2026-03-03*
*Update when style conventions shift*
