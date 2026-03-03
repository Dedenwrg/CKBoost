# Pitfalls Research

**Domain:** on-chain community campaign/reward platform
**Researched:** 2026-03-03
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Shipping Without Hard Quality Gates

**What goes wrong:**
Builds pass while lint/type/test regressions accumulate, creating unstable releases.

**Why it happens:**
Temporary bypass flags become permanent under delivery pressure.

**How to avoid:**
Re-enable blocking lint/type checks and mandatory CI test workflows before launch cycles.

**Warning signs:**
Frequent runtime errors after deploy, “works locally only” fixes, and recurring hotfix loops.

**Phase to address:**
Phase 1 (Launch Hardening Foundation)

---

### Pitfall 2: Deployment Metadata Drift Across Environments

**What goes wrong:**
Protocol/campaign scripts fail with “not found” or wrong args/code-hash behavior.

**Why it happens:**
`deployments.json`, env files, and protocol cell args are updated inconsistently.

**How to avoid:**
Add env/deployment validation scripts and explicit preflight checks in CI and runtime startup paths.

**Warning signs:**
Intermittent contract lookup failures, mismatched hash warnings, environment-specific bugs.

**Phase to address:**
Phase 2 (Verification + Reward Reliability)

---

### Pitfall 3: Incomplete End-to-End Reward Validation

**What goes wrong:**
Submission approvals occur but reward accounting/distribution is inconsistent or under-tested.

**Why it happens:**
Partial integration tests, TODO placeholders in contract test suites, and disabled SDK integration tests.

**How to avoid:**
Close placeholder tests, enable integration suites, and run real campaign simulation tests before rollout.

**Warning signs:**
Manual accounting corrections, delayed payouts, conflicting status between UI and chain artifacts.

**Phase to address:**
Phase 2 and Phase 4

---

### Pitfall 4: Over-reliance on Single Relay/Endpoint Behavior

**What goes wrong:**
Social or submission metadata appears missing/duplicated depending on relay availability.

**Why it happens:**
Assuming Nostr endpoints provide strongly consistent responses.

**How to avoid:**
Keep multi-relay fanout, dedup keys, and user-facing recovery/retry messaging.

**Warning signs:**
“Data disappeared” reports that self-resolve, inconsistent timeline ordering, relay-specific failures.

**Phase to address:**
Phase 3 (Real Campaign Validation)

---

### Pitfall 5: Expanding Scope Before Stabilizing Core Workflows

**What goes wrong:**
New feature additions increase complexity while launch-critical workflows remain brittle.

**Why it happens:**
Roadmap pressure shifts focus to differentiation over reliability.

**How to avoid:**
Use strict v1/v1.x scope boundaries and force unresolved launch blockers into active requirements.

**Warning signs:**
Large UI/feature PRs while release checklist items remain incomplete.

**Phase to address:**
All phases, especially Phase 1 and 2

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Ignoring build errors in Next config | Faster deploys | Silent regressions in production | Short-lived only during early prototyping |
| Placeholder contract tests | Quick milestone demos | Reward/validation bugs escape into real usage | Rarely; should be converted before public rollout |
| Deep relative imports into local tooling internals | Unblocks implementation quickly | Fragile runtime portability and maintenance overhead | Temporary only with follow-up refactor ticket |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| CKB deployment config | Updating one env but not protocol args/hash source | Use one validated deployment update workflow and preflight checks |
| SSRI executor | Generic error handling and poor retries | Typed error classification with retry policy and actionable messages |
| Nostr relays | Treating one relay as truth | Multi-relay read strategy + deterministic dedup |
| Telegram auth | Verbose logging with sensitive context | Mask identifiers/tokens and limit error detail in responses |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fixed high-frequency polling for all txs | Elevated RPC load and noisy client updates | Adaptive polling/backoff and stop conditions | Moderate concurrency and active admin usage |
| Heavy client-side aggregation from chain + Nostr | Slow dashboard rendering | Move expensive joins to serverless/indexed paths | Larger campaign history and user growth |
| Serverless cold-start cache resets | Inconsistent latency spikes | Introduce durable cache/index strategy | During bursts or low-traffic cold periods |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing operation secrets in logs | Credential compromise | Structured redaction + strict log review |
| Weak validation on mutation payloads | Unauthorized or malformed state updates | Boundary validation and allow-list field restrictions |
| Incomplete contract invariant tests | On-chain rule bypass under edge cases | Expand deterministic integration coverage |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Ambiguous pending/confirmed statuses | Users lose trust in reward flow | Clear lifecycle states with explorer links and refresh actions |
| Complex funding/reward forms without validation hints | User errors and failed transactions | Early validation with precise corrective messaging |
| Admin-only constraints not clearly surfaced | Non-admin users hit dead-end actions | Role-aware navigation and explicit guidance |

## "Looks Done But Isn't" Checklist

- [ ] **Campaign approval flow:** verify reward distribution and explorer-visible outcomes, not just status toggles
- [ ] **Identity verification:** verify binding persistence and role gating across sessions, not only first-run success
- [ ] **Tipping workflow:** verify approval thresholds, funding availability, and final payout state coherence
- [ ] **Onboarding docs:** verify by clean environment reproduction, not by author familiarity

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Deployment metadata drift | MEDIUM | Freeze deploys, regenerate env from canonical source, rerun validation checks |
| Reward flow inconsistency | HIGH | Pause campaign approvals, reconcile affected tx/events, patch tests and contracts/services |
| Relay inconsistency impact | MEDIUM | Switch relay priority set, backfill fetch, notify users about retry guidance |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Shipping without quality gates | Phase 1 | CI fails correctly on lint/type/test regression |
| Deployment metadata drift | Phase 2 | Preflight passes on fresh env and scripted validation |
| Incomplete reward validation | Phase 2/4 | Deterministic test matrix + real campaign UAT results |
| Relay consistency assumptions | Phase 3 | Cross-relay comparison tests and UX fallback behavior |
| Scope expansion before stabilization | Phase 1+ | Roadmap review shows blocker-first sequencing |

## Sources

- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/.planning/codebase/CONCERNS.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/milestones/Milestone 1 - Follow Ups.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/milestones/Milestone 3 - Report.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/dapp/next.config.mjs`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/contracts/tests/src/`

---
*Pitfalls research for: CKB community engagement platform*
*Researched: 2026-03-03*
