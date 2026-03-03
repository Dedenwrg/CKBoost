# CKBoost

## What This Is

CKBoost is an open-source gamified community engagement platform for the CKB ecosystem. It combines on-chain protocol/campaign/user/tipping contracts with a Next.js dApp and Netlify serverless services so communities can run campaigns, verify contributions, and distribute transparent rewards. It is built for sponsors, campaign staff, and contributors who need verifiable participation and auditable incentive flows.

## Core Value

Community contributions can be verified and rewarded end-to-end with transparent on-chain records and practical UX for real campaign operations.

## Requirements

### Validated

- ✓ Role-based dashboards exist for platform admin, campaign admin, and contributors — existing
- ✓ Campaign creation, funding, approval, and quest submission/review flows are implemented — existing
- ✓ On-chain Points UDT/achievement/tipping contract and service foundations are implemented — existing
- ✓ Telegram verification and Nostr-backed submission/comment rails are implemented — existing
- ✓ Deployment metadata + contract management workflow exists (`deployments.json`, deploy scripts, protocol config UI) — existing

### Active

- [ ] Run and support real test campaigns with stable submission/approval/reward operations
- [ ] Close launch-critical verification and reward-distribution gaps (automation, edge-case validation, consistency)
- [ ] Raise engineering quality gates (tests, CI, lint/type enforcement, hardening)
- [ ] Publish contributor/sponsor onboarding docs that match the real deployed workflow
- [ ] Prepare next-phase roadmap from validated Milestone 3 outcomes

### Out of Scope

- Native iOS/Android applications — web-first launch priority
- Full cross-chain/multi-chain support — current scope is CKB ecosystem execution
- Broad non-CKB product pivot — would dilute the grant-aligned mission and delivery focus

## Context

- Brownfield project with active codebase and deployed artifacts; architecture is already split across `dapp/`, `contracts/`, and `packages/ssri-ckboost/`.
- Existing codebase map available in `.planning/codebase/` and should be treated as baseline context.
- Milestone documentation shows substantial implementation delivered in M1/M2, with M3 focused on real campaign testing, automation research, onboarding, and next-phase planning.
- Current technical risk centers are quality gates and verification completeness rather than missing baseline product scaffolding.

## Constraints

- **Ecosystem**: CKB-first architecture and contract model — project value proposition depends on on-chain verifiability in Nervos ecosystem.
- **Runtime/Hosting**: Next.js + Netlify Functions + CKB RPC dependencies — deployment and local development must remain compatible with this stack.
- **Operational**: Existing deployment metadata and protocol registry must stay consistent (`deployments.json`, env vars, protocol cell args).
- **Delivery**: Work should preserve existing user-facing flows while improving reliability and completion of deferred milestone items.
- **Security**: Sensitive keys for Telegram and admin/proxy operations remain server-side and must not leak through logs or misconfiguration.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Initialize as brownfield (not greenfield) | Existing code and codebase map already represent a working platform baseline | ✓ Good |
| Treat Milestone 3 launch-readiness as primary near-term scope | README and milestone docs indicate this as the current project-critical objective | — Pending |
| Keep architecture direction (dApp + serverless + on-chain contracts + shared SDK) | Current system boundaries are already implemented and coherent for project goals | ✓ Good |
| Prioritize quality gates and verification completeness before major feature expansion | Current risks are reliability/operational confidence rather than missing core product surfaces | — Pending |

---
*Last updated: 2026-03-03 after initialization*
