# Requirements: CKBoost

**Defined:** 2026-03-03
**Core Value:** Community contributions can be verified and rewarded end-to-end with transparent on-chain records and practical UX for real campaign operations.

## v1 Requirements

Requirements for the current launch-readiness cycle. Each maps to roadmap phases.

### Campaign Operations

- [ ] **CAMP-01**: Sponsor can create, fund, and submit a real campaign that reaches approved status without manual data patching.
- [ ] **CAMP-02**: Campaign admin can review submissions and move them through pending/approved/rejected states with consistent UI and chain outcomes.
- [ ] **CAMP-03**: Contributor can view campaign reward availability and distributed reward history for completed quests.

### Verification & Rewards

- [ ] **VERI-01**: Contributor can complete Telegram-linked verification and see verification state persist across sessions.
- [ ] **VERI-02**: Verification-gated actions provide clear, actionable guidance when requirements are not met.
- [ ] **REWD-01**: Approved quest completions produce correct points/reward accounting with auditable transaction references.
- [ ] **REWD-02**: Reward and funding invariants are validated by automated tests for core approval/distribution paths.

### Reliability & Quality

- [ ] **QUAL-01**: Maintainer can run CI checks that fail on lint/type/test regressions before release.
- [ ] **QUAL-02**: Critical launch flows (campaign create/approve, submit/review, reward tracking) have executable regression tests.
- [ ] **QUAL-03**: Runtime error handling for RPC/SSRI/relay failures surfaces recoverable guidance instead of opaque failures.

### Operations & Documentation

- [ ] **OPS-01**: Maintainer can validate deployment/env/protocol configuration with a reproducible preflight process.
- [ ] **DOC-01**: Campaign sponsor can follow onboarding documentation to run a test campaign end-to-end.
- [ ] **DOC-02**: Contributor can follow onboarding documentation to verify identity, submit quests, and track rewards.
- [ ] **PLAN-01**: Team can produce a prioritized next-phase proposal grounded in real campaign learnings and unresolved gaps.

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Automation

- **AUTO-01**: Submission review support includes optional automation recommendations with human override controls.
- **AUTO-02**: Difficulty multipliers are reintroduced with measurable fairness and anti-gaming safeguards.

### Extended Identity

- **IDEN-01**: DID/KYC verification methods are fully integrated into production user flows.
- **IDEN-02**: Cross-method verification policy and dispute handling are documented and enforceable.

### Expansion

- **EXP-01**: Mobile-native client experience is supported for key contributor workflows.
- **EXP-02**: Cross-chain campaign/reward support is available beyond CKB-only operations.

## Out of Scope

Explicitly excluded for this roadmap cycle.

| Feature | Reason |
|---------|--------|
| Native mobile app delivery | Launch-readiness scope is web-first and already has significant hardening work |
| Broad cross-chain infrastructure | Would increase integration/security complexity before core CKB flow is stabilized |
| Fully autonomous approval automation | Human-governed trust and rule correctness must be validated first |

## Traceability

Which phases cover which requirements.

| Requirement | Phase | Status |
|-------------|-------|--------|
| QUAL-01 | Phase 1 | Pending |
| QUAL-03 | Phase 1 | Pending |
| OPS-01 | Phase 1 | Pending |
| VERI-01 | Phase 2 | Pending |
| VERI-02 | Phase 2 | Pending |
| REWD-02 | Phase 2 | Pending |
| CAMP-01 | Phase 3 | Pending |
| CAMP-02 | Phase 3 | Pending |
| QUAL-02 | Phase 3 | Pending |
| CAMP-03 | Phase 4 | Pending |
| REWD-01 | Phase 4 | Pending |
| DOC-02 | Phase 4 | Pending |
| DOC-01 | Phase 5 | Pending |
| PLAN-01 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-03 after roadmap creation*
