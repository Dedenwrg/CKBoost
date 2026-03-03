# Architecture Research

**Domain:** decentralized campaign/reward platform on CKB
**Researched:** 2026-03-03
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Experience Layer                          │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│  │ Contributor│ │ Campaign   │ │ Platform   │ │ Leader-  │ │
│  │ Flows      │ │ Admin      │ │ Admin      │ │ board    │ │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └────┬─────┘ │
├────────┴──────────────┴──────────────┴─────────────┴───────┤
│                 Application Service Layer                    │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Protocol/Campaign/User/Tipping/Achievement Services  │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                   Integration + State Layer                 │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │ CKB RPC +  │ │ Netlify      │ │ Nostr Relay  │          │
│  │ SSRI Exec  │ │ Functions    │ │ Mesh         │          │
│  └────────────┘ └──────────────┘ └──────────────┘          │
├─────────────────────────────────────────────────────────────┤
│                     On-Chain Contract Layer                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐   │
│  │ Protocol │ │ Campaign │ │ Funding  │ │ User/Tipping/ │   │
│  │ Scripts  │ │ Scripts  │ │ Lock     │ │ Achievement   │   │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Next.js dApp | User/admin UI, flow orchestration, state presentation | App Router pages + React components + hooks/providers |
| Service layer | Domain operations and transaction lifecycle orchestration | TypeScript classes in `dapp/lib/services` |
| Shared SDK | Encode/decode molecule types and invoke SSRI methods consistently | `packages/ssri-ckboost` trait wrappers |
| Serverless layer | Verification/auth/social/stat APIs and operational glue | `dapp/netlify/functions/*.ts` |
| Rust contracts | Deterministic validation of state transitions and authorization rules | Contract crates in `contracts/contracts/*` |

## Recommended Project Structure

```
repo/
├── dapp/
│   ├── app/                 # route-level UX
│   ├── components/          # reusable UI
│   ├── lib/
│   │   ├── services/        # domain orchestration
│   │   ├── ckb/             # chain access + tx helpers
│   │   ├── providers/       # app-level state contexts
│   │   └── utils/           # shared utilities
│   └── netlify/functions/   # server-side APIs
├── packages/ssri-ckboost/   # shared TypeScript SDK
├── contracts/               # Rust contracts + tests
└── docs/                    # onboarding/architecture/milestone docs
```

### Structure Rationale

- **`dapp/lib/services/` as domain boundary:** keeps UI thin and centralizes chain transaction behavior.
- **SDK separated in `packages/ssri-ckboost/`:** prevents ad-hoc contract payload logic across dApp files.
- **Contracts in dedicated workspace:** isolates chain-critical code and test harness from frontend concerns.

## Architectural Patterns

### Pattern 1: Service + Trait Wrapper Boundary

**What:** UI invokes services; services invoke SDK traits; traits invoke SSRI executor/chain.
**When to use:** Any chain mutation or domain query that crosses UI/integration boundaries.
**Trade-offs:** More indirection, but much cleaner testability and consistency.

**Example:**
```typescript
const service = new ProtocolService(signer);
const txHash = await service.updateProtocol(payload);
```

### Pattern 2: Protocol-Centric Registry Lookup

**What:** Resolve related script hashes/config from protocol cell/deployment metadata.
**When to use:** Campaign/user/tipping operations that rely on current contract addresses.
**Trade-offs:** Strong consistency if managed correctly; brittle if deployment metadata drifts.

**Example:**
```typescript
const deployment = deploymentManager.getCurrentDeployment(network, "ckboostProtocolType");
```

### Pattern 3: Hybrid On-Chain + Off-Chain Data Plane

**What:** Keep critical state on-chain; use Nostr/functions for rich metadata and operational workflows.
**When to use:** Content-heavy or social interactions not suitable for direct on-chain storage.
**Trade-offs:** Better cost/performance, but eventual-consistency and reconciliation complexity.

## Data Flow

### Request Flow

```
User Action
    ↓
Next.js UI
    ↓
Domain Service
    ↓
SDK Trait Wrapper
    ↓
SSRI Executor + CKB RPC
    ↓
Transaction/Cell Result
    ↓
Pending Tracker + UI Refresh
```

### State Management

```
Local/Provider State
    ↓ (subscribe)
Components ↔ Service Calls ↔ Pending Tx Provider
    ↓
Chain/Nostr/Function refresh loops
```

### Key Data Flows

1. **Campaign lifecycle:** create/update campaign data, fund via lock scripts, approve via protocol governance, process submissions/rewards.
2. **Identity flow:** wallet + Telegram verification data updates in user cell with server-side validation path.
3. **Tipping flow:** proposal/comment/approval and payout visibility across on-chain and social metadata layers.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Current architecture is sufficient with better QA and monitoring |
| 1k-100k users | Introduce stronger caching/indexing strategy and reduce expensive client-side joins |
| 100k+ users | Add dedicated indexing/aggregation backend and stricter asynchronous processing model |

### Scaling Priorities

1. **First bottleneck:** repeated chain/Nostr queries in UI/serverless paths; mitigate with indexed cache and smarter refresh policies.
2. **Second bottleneck:** operational consistency across deployments/config; mitigate with environment validation and CI enforcement.

## Anti-Patterns

### Anti-Pattern 1: Business Logic in Components

**What people do:** put tx assembly and chain rule checks directly in page/components.
**Why it's wrong:** creates duplication and fragile behavior across screens.
**Do this instead:** keep chain workflows in services and shared SDK abstractions.

### Anti-Pattern 2: Treating Nostr as Strictly Consistent Storage

**What people do:** assume single relay responses are complete/canonical.
**Why it's wrong:** relay availability and ordering vary.
**Do this instead:** multi-relay fetch, dedup, and graceful missing-data UX.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| CKB RPC | direct JSON-RPC via CCC clients | Central dependency for tx and state lookups |
| SSRI executor | service/SDK RPC calls | Required for trait method transaction generation |
| Nostr relays | relay pool + event dedup | Use resilience patterns for relay variability |
| Telegram auth | Netlify function verification | Keep token/secret server-side only |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| UI ↔ services | typed method calls | Preserve thin UI and deterministic domain behavior |
| services ↔ SDK | trait wrappers + typed payloads | Avoid molecule/schema drift |
| services/functions ↔ chain | CCC clients and signer contracts | Validate env/deployment consistency early |

## Sources

- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/.planning/codebase/ARCHITECTURE.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/contract-architecture.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/integration-architecture.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/dapp/lib/services/protocol-service.ts`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/packages/ssri-ckboost/src/protocol/index.ts`

---
*Architecture research for: CKB community engagement platform*
*Researched: 2026-03-03*
