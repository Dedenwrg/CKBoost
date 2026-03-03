# Feature Research

**Domain:** on-chain community campaign and reward platforms
**Researched:** 2026-03-03
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Wallet connection + identity profile | Core entry point in web3/community products | MEDIUM | Needs robust error handling and persistence |
| Campaign discovery and detail views | Users must find opportunities and understand rules/rewards | MEDIUM | Includes filtering, reward/status visibility |
| Submission workflow with review status | Contributors expect clear “submitted → pending → approved/rejected” lifecycle | HIGH | Needs reliable status reconciliation across on/off-chain states |
| Admin approval and moderation tooling | Sponsors/admins need clear governance controls | HIGH | Must avoid accidental/unauthorized state transitions |
| Reward visibility and history | Users need proof of payouts and progress | MEDIUM | Requires coherent ledger + UX formatting |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| On-chain verifiable campaign/reward logic | Transparent, auditable trust model | HIGH | Requires robust contract testing and migration strategy |
| Nostr-backed contribution context | Decentralized social proof and richer interaction data | MEDIUM | Relay variability must be tolerated |
| Tipping with peer approval and governance rules | Community-native recognition with stronger anti-abuse mechanics | HIGH | Requires careful UX for multi-party state transitions |
| Gamification (streaks, achievements, leaderboard) | Retention and motivation loop for contributors | MEDIUM | Must balance novelty with reward integrity |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| “Real-time everything” for all views | Feels modern and instant | High complexity and noisy updates with little value on all screens | Poll/refresh strategically for state-critical views only |
| Massive multi-chain expansion in same cycle | Broader market appeal | Dilutes focus, doubles integration and security burden | Stabilize CKB-first launch, then expand intentionally |
| Over-custom campaign logic per sponsor | Maximum flexibility | Creates maintenance and audit surface explosion | Keep strong template/rule framework with controlled extension points |

## Feature Dependencies

```
Wallet + User Identity
    └──requires──> User Type Contract + Verification Data
                          └──requires──> Protocol Configuration

Campaign Submission + Review
    └──requires──> Campaign Cells + Admin Review UI
                          └──requires──> Reward Distribution Flow

Leaderboard + Gamification
    └──enhances──> Contributor Retention
                          └──depends-on──> Reward/Event Integrity

Nostr Interaction Features
    ──conflicts-with──> strict single-source consistency assumptions
```

### Dependency Notes

- **Identity requires protocol + user-type consistency:** without stable script hashes and user cell resolution, verification state is unreliable.
- **Submission/review requires reward flow completion:** approval without payout visibility breaks trust.
- **Gamification depends on event correctness:** inaccurate reward events create incentive distortions.
- **Nostr interaction conflicts with strict consistency assumptions:** relay data must be treated as eventually consistent.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept.

- [ ] End-to-end campaign flow (create → approve → submit → review → reward visibility)
- [ ] Stable identity verification path (wallet + Telegram) with clear gating and status
- [ ] Leaderboard/profile and reward history that reflect real chain state
- [ ] Campaign admin and protocol admin guardrails for safe operations
- [ ] Deployment/onboarding documentation reproducible by external operators

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] Automated submission review assistance with clear override controls
- [ ] Difficulty multipliers / richer scoring model after baseline fairness is proven
- [ ] Additional verification pathways (for example DID/KYC hooks to production-grade rollout)

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] Full mobile-native client applications
- [ ] Cross-chain campaign/reward operations
- [ ] Deep personalization/recommendation layers

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| End-to-end campaign reward reliability | HIGH | HIGH | P1 |
| Identity verification stability | HIGH | MEDIUM | P1 |
| Onboarding + operational documentation | HIGH | MEDIUM | P1 |
| Automated submission review | MEDIUM | HIGH | P2 |
| Expanded verification (DID/KYC full rollout) | MEDIUM | HIGH | P2 |
| Advanced gamification tuning | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Typical Web2 Campaign Platforms | Typical Web3 Quest Platforms | CKBoost Approach |
|---------|---------------------------------|------------------------------|------------------|
| Reward transparency | Often opaque/internal ledger | Usually wallet-visible payouts | On-chain first + UI history services |
| Contribution proof | Manual screenshots/forms | Wallet actions + off-chain attestations | Hybrid: on-chain cells + Nostr metadata + admin verification |
| Governance controls | Centralized admin toggles | Varies by protocol design | Protocol/admin scripts + dApp guardrails |

## Sources

- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/README.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/milestones/Milestone 1 - Report.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/milestones/Milestone 2 - Report.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/docs/milestones/Milestone 3 - Report.md`
- `/Users/chuntengxiao/.codex/worktrees/f45a/CKBoost/.planning/codebase/ARCHITECTURE.md`

---
*Feature research for: CKB community engagement platform*
*Researched: 2026-03-03*
