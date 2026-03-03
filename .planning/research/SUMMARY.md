# Project Research Summary

**Project:** CKBoost
**Domain:** CKB-native community engagement and reward platform
**Researched:** 2026-03-03
**Confidence:** HIGH

## Executive Summary

CKBoost already has a substantial brownfield foundation: on-chain contracts for protocol/campaign/user/funding/tipping/achievement, a Next.js operations UX, and serverless integrations for verification and social context. The highest-leverage path is not a major stack pivot; it is launch hardening and reliability completion across the already selected architecture.

Research indicates this domain succeeds when end-to-end trust is visible: campaign lifecycle clarity, reward distribution integrity, and operational reproducibility. The recommended approach is to keep the current stack, close validation/testing gaps, and prioritize real campaign operations with reproducible onboarding.

The largest risks are quality-gate bypasses, deployment metadata drift, and partial reward-flow test coverage. These are solvable with phase-first hardening, deterministic testing expansion, and clearer operational runbooks.

## Key Findings

### Recommended Stack

The current stack is directionally correct: Next.js + TypeScript + Netlify Functions for application surfaces, Rust CKB contracts for deterministic policy enforcement, and a shared TypeScript SDK for trait-level interactions. This combination aligns with the product’s verifiability requirements while preserving shipping velocity.

**Core technologies:**
- Next.js + React: operator/contributor UX and routing surface
- Rust CKB contracts: source of truth for critical state transitions
- `@ckb-ccc/*` + `ssri-ckboost`: consistent chain/SSRI integration boundary
- Netlify Functions + Nostr + Telegram auth: supporting integration plane for verification and social context

### Expected Features

**Must have (table stakes):**
- Reliable campaign lifecycle (create/approve/submit/review/reward visibility)
- Stable identity verification and clear status lifecycle
- Usable admin guardrails and contributor progress/reward visibility
- Reproducible onboarding/deployment guidance

**Should have (competitive):**
- Strong on-chain transparency for rewards and governance operations
- Tipping with peer-approval and contextual social history
- Retention features (streaks, achievements, leaderboard tuning)

**Defer (v2+):**
- Mobile-native apps
- Broad cross-chain support
- Heavier personalization systems

### Architecture Approach

Continue with layered boundaries already present: UI → services → SDK traits → chain/serverless integrations → contracts. Invest in consistency and quality controls instead of re-architecting. Keep canonical state on chain, treat Nostr/serverless as complementary planes, and improve reconciliation/error handling at boundaries.

**Major components:**
1. dApp experience layer — contributor/admin interfaces and lifecycle UX
2. Domain services + shared SDK — transaction and data orchestration boundary
3. Contract + integration plane — deterministic validation and operational APIs

### Critical Pitfalls

1. **Quality gates bypassed** — enforce CI lint/type/test blocking before release
2. **Deployment metadata drift** — unify env/deployment preflight validation
3. **Reward flow under-tested** — close placeholder and disabled integration tests
4. **Relay consistency assumptions** — preserve multi-relay dedup/fallback strategy
5. **Scope expansion before stabilization** — keep blocker-first roadmap sequencing

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Launch Hardening Foundation
**Rationale:** reliability blockers must be cleared before broader rollout.
**Delivers:** strict quality gates, baseline release checklist, environment validation.
**Addresses:** launch table stakes for trust and operational stability.
**Avoids:** “looks done but isn’t” release risk.

### Phase 2: Verification + Reward Reliability
**Rationale:** this is the core value path and highest-risk integration surface.
**Delivers:** deterministic validation expansion, payout consistency checks, edge-case closure.
**Uses:** existing contracts/services without stack changes.
**Implements:** deeper integration test and runtime invariant coverage.

### Phase 3: Real Campaign Operations Validation
**Rationale:** real-user campaign evidence validates product claims.
**Delivers:** monitored real campaign runs, issue triage loops, UX fixes from field feedback.

### Phase 4: Onboarding + Scale Readiness
**Rationale:** reproducibility and maintainability are required for external adoption.
**Delivers:** clean onboarding docs, runbooks, and next-phase proposal baseline.

### Phase Ordering Rationale

- Hardening before expansion minimizes rework and public trust risk.
- Verification/reward reliability is logically upstream of campaign scale tests.
- Real-campaign learnings should feed documentation and next-phase planning.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** validation/test strategy details for edge-case contract/service coordination
- **Phase 3:** operational metrics/acceptance criteria for campaign pilots

Phases with standard patterns (skip deep research-phase if needed):
- **Phase 1:** CI/quality gate setup is well-established engineering practice
- **Phase 4:** onboarding/runbook packaging follows mature doc operations patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Confirmed by implemented architecture and dependency manifests |
| Features | HIGH | Cross-validated by README + milestone reports + active code |
| Architecture | HIGH | Clear layered boundaries already implemented in repo |
| Pitfalls | HIGH | Directly evidenced by codebase concerns and milestone follow-ups |

**Overall confidence:** HIGH

### Gaps to Address

- Automated submission review scope is currently research/proposal-level; needs explicit v1.x definition.
- Some milestone-level acceptance criteria should be formalized into measurable UAT checks.

## Sources

### Primary (HIGH confidence)
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/.planning/codebase/*.md` — validated current implementation map
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/README.md` — project-level intent and current milestone status
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/milestones/*.md` — delivered and pending milestone scope

### Secondary (MEDIUM confidence)
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/contract-architecture.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/integration-architecture.md`

---
*Research completed: 2026-03-03*
*Ready for roadmap: yes*
