---
mode: quick-full
objective: "Implement issue #48 with a Points claim-pool flow that lowers admin approve cost while keeping claim, recycle, and tipping behavior safe and verifiable."
must_haves:
  truths:
    - "Admin approve quest completion mints one or more claim-pool Points cells instead of one Points cell per approved user."
    - "The claim list and claim state live in cell data, with the first 16 bytes reserved for Points amount and the trailing bytes reserved for claim state."
    - "Claiming users can transfer Points out of the claim pool into an existing user Points cell without increasing the pool's capacity."
    - "If a claimant has no existing Points cell, the claimant supplies the extra capacity needed for the new cell."
    - "Recycle is supported for the original distributor or recycler authority, and tipping / non-quest Points validation still works."
    - "The protocol config includes a persisted `ckb_boost_claiming_lock_code_hash` entry that is read and written consistently by the protocol writer, validator, and admin UI."
    - "Regenerated SSRI types include the new ScriptCodeHashes field, and the protocol admin UI exposes it so the protocol cell can be updated without manual type shims."
    - "The new claiming lock contract is registered in the contracts workspace and follows the existing contract crate scaffold conventions."
  artifacts:
    - path: "contracts/contracts/ckboost-points-udt/src/utils.rs"
      provides: "Reworked approve-to-pool mint validation and preserved generic UDT transfer rules"
      contains: "validate_points_amount_in_quest_completion"
    - path: "contracts/contracts/ckboost-campaign-type/src/modules.rs"
      provides: "Campaign approval state updates that still track accepted submissions cleanly"
      contains: "accepted_submission_user_type_ids"
    - path: "schemas/ckboost.mol"
      provides: "Schema support for claim-pool state layout and the new claiming lock code hash field"
      contains: "ckb_boost_claiming_lock_code_hash"
    - path: "contracts/Cargo.toml"
      provides: "Workspace member registration for the new claiming lock crate"
      contains: "ckboost-claiming-lock"
    - path: "contracts/libs/ckboost-shared/src/protocol_data.rs"
      provides: "Protocol data read/write helpers and validation updated for the new claiming lock hash"
      contains: "ckb_boost_claiming_lock_code_hash"
    - path: "packages/ssri-ckboost/src/generated/ckboost.ts"
      provides: "Regenerated SSRI schema types with the new ScriptCodeHashes field"
      contains: "ckb_boost_claiming_lock_code_hash"
    - path: "dapp/lib/ckb/protocol-deployment.ts"
      provides: "Protocol deployment template and contract-status wiring that surface the new claiming lock hash"
      contains: "ckb_boost_claiming_lock_code_hash"
    - path: "dapp/components/admin/protocol-management.tsx"
      provides: "Admin protocol update flow that reads and writes the expanded ScriptCodeHashes form"
      contains: "ScriptCodeHashesLike"
    - path: "dapp/components/admin/protocol/script-code-hashes.tsx"
      provides: "Protocol settings UI that exposes the new claiming lock code hash field"
      contains: "Script Code Hashes"
    - path: "contracts/contracts/ckboost-claiming-lock/Cargo.toml"
      provides: "New claiming lock crate entry point"
    - path: "contracts/contracts/ckboost-claiming-lock/src/lib.rs"
      provides: "New claiming lock implementation for claim, repeat-claim prevention, and recycle"
    - path: "packages/ssri-ckboost/src/campaign/index.ts"
      provides: "Approve flow that creates claim-pool outputs plus claim and recycle transaction paths"
    - path: "dapp/lib/services/campaign-admin-service.ts"
      provides: "Admin service wiring for approve-to-pool, claim, and recycle flows"
  key_links:
    - from: "schemas/ckboost.mol"
      to: "packages/ssri-ckboost/src/generated/ckboost.ts"
      via: "Schema regeneration must add the new claiming lock code hash field"
      pattern: "ckb_boost_claiming_lock_code_hash"
    - from: "packages/ssri-ckboost/src/generated/ckboost.ts"
      to: "dapp/components/admin/protocol-management.tsx"
      via: "Admin protocol forms must compile against the regenerated ScriptCodeHashesLike type"
      pattern: "ScriptCodeHashesLike"
    - from: "dapp/components/admin/protocol-management.tsx"
      to: "contracts/libs/ckboost-shared/src/protocol_data.rs"
      via: "Protocol update flow must persist the new code hash through the shared protocol helpers"
      pattern: "script_code_hashes"
    - from: "contracts/contracts/ckboost-campaign-type/src/modules.rs"
      to: "contracts/contracts/ckboost-points-udt/src/utils.rs"
      via: "Quest approval delta must drive pool mint amount validation"
      pattern: "accepted_submission_user_type_ids.*validate_points_amount_in_quest_completion"
    - from: "contracts/contracts/ckboost-points-udt/src/utils.rs"
      to: "contracts/contracts/ckboost-claiming-lock/src/lib.rs"
      via: "Mint validation must accept the new claiming lock as the authorized destination"
    - from: "contracts/Cargo.toml"
      to: "contracts/contracts/ckboost-claiming-lock/Cargo.toml"
      via: "Workspace membership must include the new contract crate"
      pattern: "ckboost-claiming-lock"
    - from: "packages/ssri-ckboost/src/campaign/index.ts"
      to: "dapp/lib/services/campaign-admin-service.ts"
      via: "Approve-to-pool, claim, and recycle builders must be wired through the admin service"
      pattern: "approveCompletion|claim|recycle"
---

# 1-PLAN

## Objective
Implement the issue #48 claim-pool design so admin approval mints into a single pool cell, users claim by transferring from that pool, and the claim list stays in cell data rather than lock args.

## Task 1: Define the claiming lock and on-chain data layout
- files:
  - `contracts/contracts/ckboost-claiming-lock/Cargo.toml`
  - `contracts/contracts/ckboost-claiming-lock/src/main.rs`
  - `contracts/contracts/ckboost-claiming-lock/src/modules.rs`
  - `contracts/contracts/ckboost-claiming-lock/src/fallback.rs`
  - `contracts/contracts/ckboost-claiming-lock/src/lib.rs`
  - `contracts/contracts/ckboost-points-udt/src/utils.rs`
  - `schemas/ckboost.mol`
  - `contracts/contracts/ckboost-campaign-type/src/modules.rs`
  - `contracts/Cargo.toml`
  - `contracts/libs/ckboost-shared/src/protocol_data.rs`
  - `packages/ssri-ckboost/src/generated/ckboost.ts`
  - `dapp/lib/ckb/protocol-deployment.ts`
  - `dapp/components/admin/protocol-management.tsx`
  - `dapp/components/admin/protocol/script-code-hashes.tsx`
- action:
  - Add a new claiming lock crate and implement the minimal claim-state machine for claim and recycle.
  - Define the pool cell data layout as `[16-byte points amount][claim state blob]` and keep mutable claim state out of lock args.
  - Add the new `ckb_boost_claiming_lock_code_hash` to the protocol schema, protocol data helpers, deployment template, admin UI, and regenerated SSRI types.
  - Register the new contract crate in the contracts workspace and follow the existing crate scaffold conventions.
  - Refactor the quest-completion mint check so it validates an approve-to-pool mint, not a per-user mint.
  - Keep tipping and non-quest UDT validation paths intact.
- verify:
  - The lock can parse and update claim state from output data without relying on lock args for the claim list.
  - The mint validator rejects per-user Points outputs and accepts a single claim-pool mint with the correct amount.
  - The protocol admin UI and deployment template surface the new claiming lock code hash without type mismatches.
  - The workspace builds with the new contract crate listed in `contracts/Cargo.toml`.
  - Existing tipping validation still compiles and is not redirected into the new path.
- done:
  - The claiming lock exists, the data layout is explicit in code, the protocol hash wiring is complete, and approve-to-pool mint validation is in place.

## Task 2: Wire approve, claim, and recycle transaction construction
- files:
  - `packages/ssri-ckboost/src/campaign/index.ts`
  - `dapp/lib/services/campaign-admin-service.ts`
- action:
  - Change approve-completion construction so it emits one or more claim-pool Points outputs instead of one Points output per approved user.
  - Add the claim transaction path so a claimant can move Points from the pool into an existing user Points cell when present, or create a new user cell when the claimant supplies capacity.
  - Add the recycle transaction path for reclaiming leftover unclaimed pool funds under the recycler authority rules.
  - Keep the transaction recipe / SSRI wiring consistent with the existing build flow.
- verify:
  - Admin approval no longer loops over users to add individual Points outputs.
  - Claim transactions preserve pool capacity and only move Points amount as allowed.
  - Recycle transactions are only buildable with the intended authority input.
- done:
  - The SDK and service layer can build approve-to-pool, claim-transfer, and recycle transactions end to end.

## Task 3: Add regression tests for mint, claim, recycle, and tipping
- files:
  - `contracts/contracts/ckboost-points-udt/src/utils.rs`
  - `contracts/contracts/ckboost-campaign-type/src/modules.rs`
  - `packages/ssri-ckboost/src/campaign/index.ts`
  - `dapp/lib/services/campaign-admin-service.ts`
  - `contracts/contracts/ckboost-claiming-lock/src/lib.rs`
- action:
  - Add focused tests for approve-to-pool mint amount calculation, claim-state updates, repeat-claim rejection, recycle authority checks, and capacity preservation.
  - Add a regression check that tipping still follows the existing UDT rules and does not depend on the claiming lock.
  - Cover the user-no-existing-Points-cell branch and the existing-Points-cell transfer branch.
- verify:
  - Tests show the pool mint amount equals `quest_points * newly_approved_count`.
  - Tests show claim state updates and recycle permissions are enforced.
  - Tests show tipping behavior is unchanged.
- done:
  - The new flow is covered by targeted tests and the legacy tipping path still passes.
