status: passed

# Verification

## Must-haves

- Passed: admin approve now mints one or more claim-pool Points cells rather than one Points cell per approved user.
- Passed: claim state lives in claim-pool cell data after the first 16-byte Points amount prefix.
- Passed: claimant flows can reuse an existing Points cell or create a new one with claimant-supplied capacity.
- Passed: recycle is implemented with recycler authority checks.
- Passed: protocol config now persists `ckb_boost_claiming_lock_code_hash` across schema, generated bindings, deployment helpers, and admin forms.
- Passed: tipping and generic Points transfer validation paths remain in place.

## Commands

- `cargo test -p ckboost-claiming-lock --features library`
- `cargo test -p ckboost-points-udt --features library`
- `cargo test -p tests transaction_context_integration_tests -- --nocapture`
- `make -C /Volumes/Bohemialive/GitHub/CKBoost/contracts/contracts/ckboost-claiming-lock build`
- `make -C /Volumes/Bohemialive/GitHub/CKBoost/contracts/contracts/ckboost-points-udt build`
- `pnpm --dir /Volumes/Bohemialive/GitHub/CKBoost/packages/ssri-ckboost build`
- `pnpm --dir /Volumes/Bohemialive/GitHub/CKBoost/packages/ssri-ckboost exec node --loader ts-node/esm --test src/campaign/claiming.test.ts`
- `bash -lc 'cd /Volumes/Bohemialive/GitHub/CKBoost/dapp && pnpm exec tsc --noEmit --pretty false 2>&1 | rg "campaign-admin-service|protocol-management|script-code-hashes|protocol-deployment|deployment-manager|protocol-service|ckb_boost_claiming_lock_code_hash|buildClaimPointsTransaction|buildRecycleClaimPoolTransaction|claimPoints|recycleClaimPool"'`

## Notes

- The contract `Makefile` emitted a local `find_clang: Command not found` message before the target builds because the per-contract scaffold does not include its own `scripts/find_clang`, but both contract builds still completed successfully in this environment.
- `packages/ssri-ckboost` default `pnpm test` remains blocked by the existing `jest.config.js` ESM/CommonJS mismatch, so the new unit coverage was run through Node's built-in test runner instead.
