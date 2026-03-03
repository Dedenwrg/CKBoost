# Codebase Concerns

**Analysis Date:** 2026-03-03

## Tech Debt

**Build Quality Gates:**
- Issue: TypeScript and ESLint errors are allowed during Next.js builds (`ignoreBuildErrors`, `ignoreDuringBuilds` in `dapp/next.config.mjs`)
- Why: Keeps deployment moving while development is active
- Impact: Regressions can ship without failing CI/build
- Fix approach: Re-enable strict build checks and enforce lint/type jobs in CI

**Contract Fallback/Validation Coverage:**
- Issue: Multiple contract areas still rely on fallback patterns and TODO markers
- Why: Incremental implementation of all SSRI methods/validation branches
- Impact: Behavior can be less explicit and harder to audit for edge cases
- Fix approach: Complete TODO branches and expand explicit recipe validation coverage

**Test Debt in Rust Suites:**
- Issue: Several contract test files are TODO skeletons without real assertions (`contracts/tests/src/test_funding_lock.rs`, `test_udt_funding.rs`, `test_udt_distribution.rs`)
- Why: Placeholder scaffolding created before full scenario wiring
- Impact: Important reward/funding lock behaviors are weakly protected
- Fix approach: Convert placeholders into executable fixtures/assertions with realistic tx contexts

## Known Bugs

**Protocol Test Mock Inconsistencies:**
- Symptoms: Test logs mention expected failure due to mock protocol data mismatch
- Trigger: Running some scenarios in `contracts/tests/src/protocol_type_tests.rs`
- Workaround: Treat as known mock-data limitation during current test execution
- Root cause: Mock code hash/data setup diverges from updated validation assumptions

**Potential Env Template Corruption:**
- Symptoms: Root `.env.example` includes malformed trailing text (`EOF < /dev/null# ...`)
- Trigger: Copying template directly for new env setup
- Workaround: Manually clean/verify env template lines before use
- Root cause: Likely accidental script/heredoc residue in committed file

## Security Considerations

**Serverless Secret Exposure Risk:**
- Risk: Netlify function handlers process sensitive keys/tokens (`TELEGRAM_BOT_TOKEN`, `NETLIFY_API_AUTHENTICATOR_PRIVATE_KEY`)
- Current mitigation: Values are read from env and not hardcoded in source
- Recommendations: Add strict log redaction and rotate keys if accidental logging occurs

**Custom Relative Imports to Local Tooling Paths:**
- Risk: Deep relative import to local `ccc` path in function (`dapp/netlify/functions/telegram-authenticate.ts`) can create environment mismatch and supply-chain ambiguity
- Current mitigation: Works in current monorepo layout
- Recommendations: Replace with published package import boundary to reduce coupling

## Performance Bottlenecks

**Chain Polling Frequency:**
- Problem: Pending transaction provider polls RPC with default 5s interval (`NEXT_PUBLIC_PENDING_TX_POLL_INTERVAL_MS` fallback 5000)
- Measurement: Poll cycle runs continuously when tracked tx exist
- Cause: Client-side confirmation tracking design
- Improvement path: Adaptive backoff and batched tx status queries

**Nostr Aggregation on Serverless:**
- Problem: Social interaction endpoint queries multiple relays and deduplicates per request path
- Measurement: Latency depends on relay responsiveness and event volume
- Cause: Fan-out relay strategy and JSON parsing/dedup work
- Improvement path: Add bounded windows, shared cache persistence, and relay health scoring

## Fragile Areas

**Deployment Metadata Coupling:**
- Why fragile: Many flows require synchronized `deployments.json` + env vars + protocol cell args
- Common failures: "contract not found" or wrong script hash/args errors
- Safe modification: Change deployment metadata and env vars together; validate with dry-run service calls
- Test coverage: Partially covered, but operational misconfig still easy

**Protocol Cell Initialization/Update Path:**
- Why fragile: Singleton/type-id assumptions and witness references are sensitive to tx shape
- Common failures: Missing input/output indexes or incorrect script args cause rejection
- Safe modification: Update alongside contract tests and SDK payload encoding
- Test coverage: Better than average in `protocol_type_tests.rs` and `transaction_context_integration_tests.rs`, but still has mock-data caveats

## Scaling Limits

**Serverless Cache Persistence:**
- Current capacity: In-memory caches in Netlify functions survive only warm instances
- Limit: Cold starts drop cache and require full re-fetch
- Symptoms at limit: Higher latency, repeated external calls
- Scaling path: Add durable cache layer or upstream indexed data service

**Client-Side Heavy Lifting:**
- Current capacity: Browser performs many chain-decoding and aggregation operations
- Limit: Large campaign/user datasets can increase UI load time
- Symptoms at limit: Slow dashboard rendering and delayed interactions
- Scaling path: Move heavy aggregation to dedicated backend/indexer paths

## Dependencies at Risk

**Local File SDK Dependency:**
- Risk: `ssri-ckboost` consumed via `file:../packages/ssri-ckboost` can drift if build artifacts are stale
- Impact: Runtime/build mismatch in dApp
- Migration plan: Add explicit workspace build verification and/or publish pinned package versions for releases

**Multiple Relay Dependency Quality:**
- Risk: Nostr relay reliability varies over time
- Impact: Missing/duplicated social metadata and inconsistent UX
- Migration plan: Add relay reputation tracking and fallback indexing service

## Missing Critical Features

**End-to-End CI for Build/Test:**
- Problem: Existing workflows focus on Claude automation rather than mandatory compile/test gates
- Current workaround: Local/manual test execution
- Blocks: Reliable automated regression prevention on PRs
- Implementation complexity: Medium

**Complete Contract Scenario Tests:**
- Problem: Key reward/funding tests are placeholders
- Current workaround: Manual reasoning and partial integration tests
- Blocks: Confident changes to funding/approval logic
- Implementation complexity: Medium to High

## Test Coverage Gaps

**Funding/UDT Distribution Cases:**
- What's not tested: Real assertions for funding unlock paths and multi-asset distribution edge cases
- Risk: Silent regressions in payout and lock logic
- Priority: High
- Difficulty to test: Medium (requires full tx fixture setup)

**SDK Integration Cases Disabled:**
- What's not tested: Some protocol integration tests are present but disabled via `.ignore`
- Risk: SSRI executor integration regressions may go unnoticed
- Priority: Medium
- Difficulty to test: Medium (environment and dependency setup)

---

*Concerns audit: 2026-03-03*
*Update as issues are fixed or new ones discovered*
