# Stack Research

**Domain:** CKB-native community engagement and reward platform
**Researched:** 2026-03-03
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js + React | Next 15.x / React 19.x | Web application shell, routing, admin/contributor UX | Already implemented, strong SSR/ISR support, stable ecosystem for dashboard-heavy products |
| TypeScript | 5.x | Type-safe app/services/sdk code | Required for safe cross-layer payloads and long-term maintainability in multi-package system |
| Rust + ckb-std + ckb-ssri-std | 2021 edition + current crate set in repo | Deterministic on-chain contract logic | Required for CKB script execution guarantees and protocol-level rule enforcement |
| CKB CCC stack (`@ckb-ccc/*`) | current in repo | Chain client, signer abstraction, tx assembly | Purpose-built for CKB integration and already deeply wired into this codebase |
| Netlify Functions (TypeScript) | current runtime | Server-side verification, social APIs, operational endpoints | Fits existing deploy shape and reduces ops overhead for API-style glue services |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ssri-ckboost` (workspace package) | local package | Shared contract trait wrappers and molecule types | All dApp/service paths that need SSRI method calls and decode/encode consistency |
| `@nostrify/*` + `nostr-tools` | current in repo | Off-chain metadata and social interaction rails | Submission/comment/like content where on-chain storage is impractical |
| `@telegram-auth/*` | current in repo | Anti-sybil identity verification path | Telegram-linked verification and role-gating flows |
| `zod` | 3.x | Runtime validation at service/function boundaries | Any untrusted payload (HTTP input, relay payloads, dynamic config) |
| `@testing-library/react` + Jest | current in repo | UI/unit test surface | Component and service regression tests for dApp behavior |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| pnpm workspaces | Deterministic multi-package JS dependency management | Keep dApp and SDK builds synchronized in CI |
| Cargo workspace | Contract and test orchestration | Enables shared crate reuse and consistent profile flags |
| moleculec + generation script | Schema-driven type generation | Keep `schemas/ckboost.mol` as single source of truth |
| ESLint + TypeScript checks | Static quality gates | Should be enforced in CI rather than ignored during builds |

## Installation

```bash
# dApp + SDK
cd dapp && pnpm install
cd ../packages/ssri-ckboost && pnpm install

# contracts
cd ../contracts && cargo build

# local app + functions
cd ../dapp && netlify dev
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Netlify Functions | Dedicated long-running backend service | Use when cache consistency, queueing, or complex async orchestration outgrows serverless lifecycle limits |
| Nostr for non-critical metadata | Fully centralized database | Use centralized DB for strict consistency/compliance requirements that Nostr relay variance cannot satisfy |
| Workspace-local SDK package | Published remote SDK artifact only | Publish versioned SDK for external integrators or stricter release discipline |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Ignoring lint/type errors in production builds | Lets regressions pass release gates | Enforce lint/type in CI and remove build ignores |
| Ad-hoc per-feature contract interaction logic in UI | Creates duplicated encoding and drift | Keep all trait calls in `ssri-ckboost` + dApp service layer |
| Single-relay assumptions for Nostr data | Relay availability and ordering are not guaranteed | Multi-relay fanout with dedup + fallback UX |

## Stack Patterns by Variant

**If focus is launch hardening:**
- Use stricter CI/test gates first
- Because reliability and auditability are the primary near-term constraints

**If focus is feature expansion:**
- Keep existing architecture but add capabilities through service + contract trait boundaries
- Because these boundaries are already established and reduce integration risk

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `next@15.x` | `react@19.x` | Current repo pairing; preserve together during upgrades |
| `jest@29.x` | `ts-jest@29.x` | Existing config uses this combination in SDK |
| Rust workspace crates | `ckb-std` / `ckb-ssri-std` / `ckb_deterministic` versions pinned in manifests | Upgrade in lockstep to avoid contract runtime drift |

## Sources

- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/.planning/codebase/STACK.md` — current implemented stack
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/README.md` — project architecture and roadmap context
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/contract-architecture.md` — protocol registry and deployment model
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/dapp/package.json` and `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/contracts/Cargo.toml` — concrete dependency/runtime versions

---
*Stack research for: CKB community engagement platform*
*Researched: 2026-03-03*
