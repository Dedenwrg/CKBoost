# Testing Patterns

**Analysis Date:** 2026-03-03

## Test Framework

**Runner:**
- dApp: Jest with Next.js adapter via `next/jest` (`dapp/jest.config.js`)
- SDK: Jest + `ts-jest` (`packages/ssri-ckboost/jest.config.js`)
- Contracts: Cargo test suite with `ckb-testtool` harness (`contracts/tests/Cargo.toml`)

**Assertion Library:**
- TypeScript tests use Jest `expect`
- Rust tests use standard Rust assertion macros (`assert!`, `assert_eq!`) in `contracts/tests/src/*.rs`

**Run Commands:**
```bash
cd dapp && pnpm test                      # dApp tests
cd dapp && pnpm test:watch                # Watch mode
cd dapp && pnpm test:coverage             # Coverage report

cd packages/ssri-ckboost && npm test      # SDK Jest tests
cd packages/ssri-ckboost && ./scripts/test.sh unit
cd packages/ssri-ckboost && ./scripts/test.sh integration

cd contracts && cargo test                # Rust/contract tests
```

## Test File Organization

**Location:**
- dApp tests live in app/lib/component areas and rely on `dapp/jest.setup.js`
- SDK tests are colocated with protocol code in `packages/ssri-ckboost/src/protocol/*.test.ts`
- Contract tests are centralized in `contracts/tests/src/*.rs`

**Naming:**
- Unit/simple tests: `*.test.ts`, `*.simple.test.ts`
- Integration-style Rust tests: `transaction_context_integration_tests.rs`, `protocol_type_tests.rs`
- Disabled tests marked with `.ignore` suffix in SDK (`protocol.test.ts.ignore`, `protocol.integration.test.ts.ignore`)

**Structure:**
```
packages/ssri-ckboost/src/protocol/
  index.ts
  protocol.simple.test.ts
  protocol.test.ts.ignore
  protocol.integration.test.ts.ignore

contracts/tests/src/
  lib.rs
  protocol_type_tests.rs
  transaction_context_integration_tests.rs
  test_funding_lock.rs
  test_udt_funding.rs
  test_udt_distribution.rs
```

## Test Structure

**Suite Organization:**
- Jest suites use nested `describe`/`it` blocks (example: `packages/ssri-ckboost/src/protocol/protocol.simple.test.ts`)
- Rust tests are function-oriented with `#[test]` attributes in focused modules

**Patterns:**
- Arrange/act/assert style in TS unit tests
- Protocol transaction scenarios modeled as deterministic integration tests in Rust
- Test environment helpers centralized in `contracts/tests/src/lib.rs`

## Mocking

**Framework:**
- dApp uses Jest module mocks (for example wallet connector mocks in `dapp/jest.setup.js`)
- SDK relies mostly on direct unit inputs, with minimal deep mock infrastructure

**Patterns:**
- Global setup file defines common mocks and environment initialization
- External wallet/chain providers are stubbed for deterministic UI/service tests

**What to Mock:**
- Wallet connector APIs
- Network-facing dependencies in UI tests
- Time-variant or external calls when testing utility behavior

**What NOT to Mock:**
- Core contract logic (validated in Rust integration tests)
- Molecule encoding/decoding primitives in SDK where possible

## Fixtures and Factories

**Test Data:**
- Rust tests use helper constructors and environment setup in `contracts/tests/src/lib.rs`
- SDK tests create in-memory protocol/config payloads in test bodies

**Environment Setup:**
- dApp Jest setup (`dapp/jest.setup.js`) bootstraps DOM matchers and mocks
- SDK Jest setup (`packages/ssri-ckboost/jest.setup.js`) loads env values

## Coverage and Quality Signals

**Coverage Commands:**
- `pnpm test:coverage` in dApp
- SDK `collectCoverageFrom` configured in Jest config

**Gaps:**
- Several Rust test files currently contain TODO placeholders rather than executable assertions (`contracts/tests/src/test_funding_lock.rs`, `test_udt_funding.rs`, `test_udt_distribution.rs`)
- Some SDK integration tests are disabled via `.ignore`
- No unified cross-repo CI pipeline runs all test suites automatically in detected workflows

---

*Testing analysis: 2026-03-03*
*Update when test framework or strategy changes*
