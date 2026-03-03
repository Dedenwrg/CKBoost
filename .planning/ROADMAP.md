# Roadmap: CKBoost

## Overview

This roadmap transitions CKBoost from a feature-rich brownfield prototype to a launch-ready, reproducible platform for real campaign operations. The sequence prioritizes safety and reliability first, then validates real-user campaign execution, and finally packages operational learning into repeatable onboarding and next-phase planning.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Quality Gate Foundation** - Reinstate release guardrails and environment preflight checks.
- [ ] **Phase 2: Verification & Reward Invariants** - Harden verification and reward correctness with deterministic test coverage.
- [ ] **Phase 3: Campaign Lifecycle Reliability** - Stabilize real campaign creation, review, and regression-critical flows.
- [ ] **Phase 4: Contributor Reward Transparency** - Ensure contributors can trust and trace reward outcomes.
- [ ] **Phase 5: Sponsor Onboarding & Ops Runbooks** - Make deployment and campaign operations reproducible by external teams.
- [ ] **Phase 6: Pilot Readout & Next-Phase Proposal** - Consolidate pilot learnings and define prioritized continuation scope.

## Phase Details

### Phase 1: Quality Gate Foundation
**Goal**: Establish non-optional quality gates and configuration validation to prevent unsafe releases.
**Depends on**: Nothing (first phase)
**Requirements**: [QUAL-01, QUAL-03, OPS-01]
**Success Criteria** (what must be TRUE):
  1. CI fails when lint/type/test regressions are introduced.
  2. Build/deploy flow no longer relies on suppressing type/lint errors for release readiness.
  3. Maintainers can run a preflight checklist/command that validates env/deployment consistency before critical ops.
**Plans**: 3 plans

Plans:
- [ ] 01-01: Reinstate strict lint/type checks and document release gate policy.
- [ ] 01-02: Implement/standardize deployment configuration preflight validation.
- [ ] 01-03: Improve runtime failure messaging and recovery guidance for RPC/SSRI/relay boundaries.

### Phase 2: Verification & Reward Invariants
**Goal**: Close correctness gaps in verification and reward/funding invariants with executable coverage.
**Depends on**: Phase 1
**Requirements**: [VERI-01, VERI-02, REWD-02]
**Success Criteria** (what must be TRUE):
  1. Telegram-linked verification status is consistent and persists across normal user sessions.
  2. Verification-gated actions consistently return actionable guidance for unverified users.
  3. Funding/reward invariant checks have executable deterministic tests covering core edge cases.
**Plans**: 3 plans

Plans:
- [ ] 02-01: Harden verification persistence and status reconciliation across dApp + function boundaries.
- [ ] 02-02: Convert placeholder invariant tests into executable contract/service scenarios.
- [ ] 02-03: Add regression harness for approval/distribution edge cases.

### Phase 3: Campaign Lifecycle Reliability
**Goal**: Prove campaign create/fund/approve/review flows work reliably in realistic operations.
**Depends on**: Phase 2
**Requirements**: [CAMP-01, CAMP-02, QUAL-02]
**Success Criteria** (what must be TRUE):
  1. Sponsors can launch test campaigns without manual state patching.
  2. Campaign admins can process pending submissions with stable, consistent outcomes.
  3. Critical lifecycle flows are covered by executable regression tests and pass in CI.
**Plans**: 3 plans

Plans:
- [ ] 03-01: Run campaign lifecycle reliability pass across create/fund/approve/review endpoints.
- [ ] 03-02: Add end-to-end lifecycle test paths and failure-case assertions.
- [ ] 03-03: Fix defects surfaced by pilot lifecycle runs and regression tests.

### Phase 4: Contributor Reward Transparency
**Goal**: Make contributor-facing reward state and payout evidence trustworthy and easy to verify.
**Depends on**: Phase 3
**Requirements**: [CAMP-03, REWD-01, DOC-02]
**Success Criteria** (what must be TRUE):
  1. Contributors can see reward availability and distributed totals that match chain outcomes.
  2. Approved completions surface auditable transaction references for reward events.
  3. Contributor onboarding documentation is accurate for identity, submission, and reward tracking flows.
**Plans**: 3 plans

Plans:
- [ ] 04-01: Align contributor reward views with canonical chain/service reconciliation logic.
- [ ] 04-02: Ensure transaction evidence links and status lifecycle are consistently exposed.
- [ ] 04-03: Publish/update contributor-facing onboarding guide with verified walkthrough.

### Phase 5: Sponsor Onboarding & Ops Runbooks
**Goal**: Enable sponsors/operators to deploy and run campaigns using reproducible guidance.
**Depends on**: Phase 4
**Requirements**: [DOC-01]
**Success Criteria** (what must be TRUE):
  1. A sponsor can follow docs to deploy/configure an environment and launch a test campaign.
  2. Operational runbooks cover common failure modes and recovery procedures.
  3. Documentation is validated against a clean-environment rehearsal.
**Plans**: 2 plans

Plans:
- [ ] 05-01: Produce sponsor deployment/onboarding runbook with preflight and rollback guidance.
- [ ] 05-02: Validate docs via clean-environment rehearsal and patch discovered gaps.

### Phase 6: Pilot Readout & Next-Phase Proposal
**Goal**: Consolidate pilot evidence and produce a data-informed roadmap for subsequent work.
**Depends on**: Phase 5
**Requirements**: [PLAN-01]
**Success Criteria** (what must be TRUE):
  1. Real campaign pilot outcomes and unresolved issues are documented with priority labels.
  2. Next-phase proposal includes sequenced work with rationale tied to observed risks/value.
  3. Stakeholders can review a clear transition package for the next milestone cycle.
**Plans**: 2 plans

Plans:
- [ ] 06-01: Compile pilot metrics, defects, and learnings into a release readout.
- [ ] 06-02: Produce next-phase proposal with prioritized initiatives and dependency notes.

## Progress

**Execution Order:**
Phases execute in numeric order: 2 → 2.1 → 2.2 → 3 → 3.1 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Quality Gate Foundation | 0/3 | Not started | - |
| 2. Verification & Reward Invariants | 0/3 | Not started | - |
| 3. Campaign Lifecycle Reliability | 0/3 | Not started | - |
| 4. Contributor Reward Transparency | 0/3 | Not started | - |
| 5. Sponsor Onboarding & Ops Runbooks | 0/2 | Not started | - |
| 6. Pilot Readout & Next-Phase Proposal | 0/2 | Not started | - |
