# Quick Task 1 Summary

## Goal

Implement issue #48 with a Points claim-pool flow that reduces admin approve-time CKB and capacity cost by minting one or more pooled Points cells instead of one Points cell per approved user.

## What Changed

### On-chain claiming flow

- Added a new `ckboost-claiming-lock` contract at `/Volumes/Bohemialive/GitHub/CKBoost/contracts/contracts/ckboost-claiming-lock/`.
- The claiming lock keeps the claim list in cell data, not lock args.
- The claiming lock validates two state transitions:
  - `claim`: one approved entry flips from unclaimed to claimed, the pool amount decreases by `points_per_claim`, the claimant's Points balance increases by the same amount, and the claim-pool capacity does not decrease.
  - `recycle`: the recycler authority can consume the claim pool and recover the remaining unclaimed Points.
- The claim-pool data layout is:
  - `[16-byte total points amount][claim state blob]`
  - `claim state blob = magic("CKBCLM01") + quest_id(u32) + chunk_index(u32) + points_per_claim(u128) + entry_count(u32) + repeated(user_type_id(byte32) + claimed_flag(u8))`
- The claiming lock args layout is:
  - `protocol_type_hash(byte32) + recycler_lock_hash(byte32) + campaign_type_hash(byte32) + quest_id(u32) + chunk_index(u32)`

### Points mint validation

- Reworked `/Volumes/Bohemialive/GitHub/CKBoost/contracts/contracts/ckboost-points-udt/src/utils.rs`.
- `validate_points_amount_in_quest_completion` now validates approve-to-pool minting instead of the old per-user mint path.
- The validator now:
  - finds the single quest that received newly approved users
  - computes `expected_mint = quest_points * newly_approved_count`
  - checks the actual Points mint delta against that expected amount
  - requires the minted Points outputs to be locked by the claiming lock
  - requires the claim-pool outputs to target the same protocol, campaign, and quest
  - requires all minted claim-pool entries to start as unclaimed
  - requires the aggregated claim-pool user list to match the newly approved users exactly
- Tipping and generic non-mint Points transfer rules were left intact.

### Protocol schema and admin wiring

- Added `ckb_boost_claiming_lock_code_hash` to `/Volumes/Bohemialive/GitHub/CKBoost/schemas/ckboost.mol`.
- Regenerated shared Rust and TypeScript bindings.
- Updated protocol read/write helpers, deployment templates, deployment status checks, and admin protocol forms so the claiming lock code hash is persisted and editable.

### SDK and service flow

- Added `/Volumes/Bohemialive/GitHub/CKBoost/packages/ssri-ckboost/src/campaign/claiming.ts` for:
  - chunking approved users
  - encoding and decoding claim-pool data
  - encoding and decoding claiming lock args
  - marking a single entry as claimed
- Updated `/Volumes/Bohemialive/GitHub/CKBoost/packages/ssri-ckboost/src/campaign/index.ts`:
  - approve now creates one or more claim-pool Points outputs instead of per-user Points outputs
  - added claim transaction construction
  - added recycle transaction construction
  - new outputs use real cell capacities derived from output data instead of zero-capacity placeholders
- Updated `/Volumes/Bohemialive/GitHub/CKBoost/dapp/lib/services/campaign-admin-service.ts`:
  - added claim-pool cell deps
  - added `buildClaimPointsTransaction` / `claimPoints`
  - added `buildRecycleClaimPoolTransaction` / `recycleClaimPool`
  - recycle now ensures a recycler-authorized input is present before submission

## Transaction Shapes

### Approve

- Inputs:
  - existing campaign cell
  - any other existing admin inputs required for capacity / fee
- Outputs:
  - updated campaign cell with newly approved users recorded
  - one or more claim-pool Points cells locked by the claiming lock
  - existing UDT reward outputs for non-Points rewards, unchanged

### Claim

- Inputs:
  - one claim-pool Points cell
  - claimant Points cell if it already exists
  - claimant capacity input if a new Points cell must be created
- Outputs:
  - updated claim-pool Points cell with one entry marked claimed and reduced Points amount
  - updated claimant Points cell or a newly created claimant Points cell

### Recycle

- Inputs:
  - one claim-pool Points cell
  - recycler-authorized input
- Outputs:
  - a normal Points cell under the recycler lock with the remaining unclaimed Points amount

## Tests and Verification

- Added `/Volumes/Bohemialive/GitHub/CKBoost/packages/ssri-ckboost/src/campaign/claiming.test.ts` for chunking, claim-pool encoding, claiming-lock args encoding, and claim-state updates.
- Added unit tests inside the claiming lock for claim-pool parsing and single-claim transition detection.
- Verified both modified contracts build for the RISC-V target.

## Remaining Risks

- Recycle is implemented as immediately available to the recycler authority, because that matched the requested behavior. Product-wise this means claims remain revocable until users actually claim.
- The new claim / recycle paths are implemented at the SDK and service layer, but there is no dedicated front-end UI in this quick task.
- The Jest entrypoint in `packages/ssri-ckboost` is still broken by an existing ESM/CommonJS config mismatch, so the new SDK tests were executed through Node's built-in test runner with `ts-node/esm` instead of the package's default `pnpm test` script.
