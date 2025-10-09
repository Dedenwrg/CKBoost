# Milestone 2 Follow Ups

## Verification & Identity

5. [ ] Verification requirement enforcement for campaigns
   - Campaign gating relies on verification flags, however the rules are not enforced consistently across submission builders and admin approval flows.

## Gamification & Leaderboards

1. [ ] Leaderboard data durability and scheduled refresh
   - `LeaderboardService` aggregates live Points mints, but it currently runs in-memory. Add persistent caching (e.g., KV/Cloudflare Worker), scheduled refresh jobs, and guards against long RPC scans.
2. [ ] Streak bonus computation engine
   - Streak configuration is mocked in `dapp/app/platform-admin/page.tsx`; implement actual streak tracking, persistence, and reward calculation for dashboard displays.
3. [ ] Difficulty multipliers and badge milestones
   - Define multiplier formulas, surface them in quest completion, and mint badge metadata into user profiles once thresholds are met.
4. [ ] Profile progress insights
   - User dashboard visualises submissions, but lacks historical charts, activity heatmaps, and streak callouts to meet milestone targets.

## Tipping System

1. [ ] Finalise `CKBoostTipping.update_tipping` reward distribution rules
   - `contracts/contracts/ckboost-tipping-type/src/recipes.rs:266` leaves reward checks unimplemented; enforce vault withdrawals, split validation, and proper Points/CKB accounting before marking tips as granted.
2. [ ] Multi-signature approval UX backed by on-chain updates
   - `dapp/components/tippings.tsx:58` mutates local state without pushing supporter approvals to the contract. Replace mocks with real signer flows and optimistic transaction feedback.
3. [ ] Tipping admin review & escalation tooling
   - Platform admin dashboard uses mock data; add real proposal review queues, evidence viewing, and escalation actions tied to protocol data.
4. [ ] Funding pool visibility for proposers
   - Expose treasury capacity (CKB + UDT) and payout forecasts using `TippingService.getFundingSummary()` so proposers can size requests responsibly.

## Admin Dashboards & Analytics

1. [ ] Replace mock datasets with live protocol data
   - `dapp/app/platform-admin/page.tsx:77` still renders placeholder campaigns, tipping votes, and reward tiers. Hook up protocol data providers and allow filtering by real status.
2. [ ] Unified moderation queue
   - Aggregate pending campaign approvals, tipping proposals, and verification requests into a single queue with bulk actions and audit logging.
3. [ ] Analytics & reporting widgets
   - Build charts for submission throughput, verification pass rates, and reward burn rates to support milestone reporting.
4. [ ] Role-based access enforcement
   - Harden admin routes so only authorised lock hashes can view sensitive dashboards once identity verification is complete.

## DevOps, Testing & Documentation

## ⚠️ Deferred Issues & New Todo Items

### 2. Tipping approvals not persisted

- **File**: `dapp/components/tippings.tsx:58`
- **Issue**: Approvals are appended to client state only, leaving the chain untouched.
- **Status**: Replace with SSRI-powered transactions once grant path is ready.

### 3. Admin dashboard still mocked

- **File**: `dapp/app/platform-admin/page.tsx:77`
- **Issue**: Campaign, tipping, and leaderboard panels use hard-coded fixtures, preventing real moderation.
- **Status**: Blocked on data providers; wire to protocol + tipping services when endpoints stabilise.
