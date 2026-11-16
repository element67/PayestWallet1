## Implementation Plan: NairaBridge audit fixes, Supabase migration and Next.js conversion

### Summary
NairaBridge is a sandbox crypto-to-Naira exchange and Naira wallet for Nigerian customers and the founders who run it. Three parts: (1) fix all 21 audit findings (NB-01 to NB-21) with tests, (2) move the database from SQLite to Supabase Postgres, (3) convert the Vite app and Bun API into a Next.js App Router app with a Bun worker. The user approves each stage before the next begins. Testnet and sandbox only.

### Architecture
- Blockchain: Arc Testnet (USDC live). Other chains stay simulated or testnet. Nothing touches mainnet.
- Contract: contracts/script/Create2Factory.sol only. Salt namespaced to caller on-chain; first Foundry tests added.
- Database: Supabase Postgres, server-only access via DATABASE_URL (direct or session pooler) with the `postgres` driver. No Supabase Auth, no supabase-js. Existing auth kept (argon2id, bearer sessions). Token amounts are NUMERIC(78,0) so sums are exact (kills the NB-01 class). RLS enabled on every table with no policies. Ledger immutability via Postgres triggers. Balance writes use per-account advisory transaction locks taken in sorted order. Job queue uses FOR UPDATE SKIP LOCKED.
- Backend: existing route registry in server/http.ts is kept; one Next.js catch-all route handler at /api/* serves it. A separate Bun worker process runs the queue, Arc and wallet monitors, the transaction agent and reconcile loops, guarded by a Postgres advisory leader lock.
- Frontend: Next.js App Router run under Bun (`bun --bun next dev`, port 5173). Existing screens become client components, one route per page: /, /exchange, /crypto, /wallet, /activity, /alerts, /more, /profile, /settings, /founder, /agent. Providers (wagmi, ConnectKit, react-query, sonner, theme, text size, session) move into a root client providers component.
- Wallet: ConnectKit + wagmi as today.
- Needs from user at Stage 2: a Supabase project and Postgres connection string in .env as DATABASE_URL (never pasted in chat). Until then develop and test against a local Postgres container with the same schema.
- Known limits: Next route handlers cannot see the raw socket IP, so rate limiting / audit IPs depend on TRUST_PROXY and TRUSTED_PROXY_HOPS (NB-13). Hashing keeps using Bun argon2id, so production runs on Bun.

### Files to Create/Modify

Stage 1: audit fixes on the current SQLite app
1. server/ledger.ts (NB-01, NB-08): sum delta as BigInt in TypeScript in balanceOf, balancesFor, verifyLedger (no CAST AS INTEGER, no float reads); helper to book fees to SYS.fees.
2. server/db.ts (NB-01, NB-05): safe integers; DB_PATH override for tests; idempotent migration adding log_index to wallet_txs and rebuilding its unique key to (network, tx_hash, log_index, user_id, type).
3. server/routes.ts (NB-02, NB-15): POST /api/orders looks up quote side and treats missing funding as wallet for buys so frozen-wallet and PIN checks always run; dev-session requires same-origin Sec-Fetch-Site and an Origin allowlist.
4. server/orders.ts (NB-02, NB-03, NB-08, NB-09): assertOperational inside createOrder for wallet funding; bank-payout-aware reverseOrder (never debit user wallet for a bank payout; if payout already sent raise critical alert for manual recovery; if it never left move sys:bank back to house); handlePaymentEvent ignores terminal orders; book fees house -> sys:fees (idem fee:<orderId>) and reverse on reversal; check move() result before sendPayout.
5. server/cryptoOps.ts (NB-08, NB-12): book swap fees to sys:fees; use shared daily-volume accumulator.
6. server/agent.ts (NB-04, NB-05, NB-06, NB-09): single payout job key order.payout:<id>; logIndex in Observation and ingest() keyed on (chain, tx_hash, log_index); remove amount-only fallback in findOrder; fake-token / wrong-sender / wrong-amount transfers recorded in chain_txs and alerts only, never set orders.tx_hash; flagged orders stay cancellable and still accept a later valid deposit.
7. server/chain/arc.ts (NB-04, NB-05, NB-06, NB-20): refreshOpen separates receipt-not-found from transport errors; drop only after several consecutive misses while head advances (missing_count column); trackHints requires tx sender == order from_address and approved USDC log; clamp confirmations Math.max(1, ...).
8. server/wallet/monitor.ts (NB-05, NB-20): dedupe incoming by log_index; clamp confirmations.
9. server/tokens/verify.ts (NB-10): exact symbol match plus explicit allowlist of known testnet wrapper symbols (WETH, USDC.e).
10. server/vault.ts, server/withdrawals.ts, server/orders.ts (NB-11, NB-21): validDestination looks up the token's chain family (evm, solana, bitcoin) from the registry; remove dead NGN branches in withdrawals.ts.
11. server/assets.ts (NB-12): dailyVolumeKobo also sums swap volume (crypto_ops) and withdrawal value; all endpoints use it; remove duplicated swap terms.
12. server/index.ts, server/http.ts, server/config.ts (NB-13): trust x-forwarded-for only when TRUST_PROXY=true using TRUSTED_PROXY_HOPS; otherwise socket address.
13. src/tracing.ts, src/console-capture.ts (NB-14): no '*' fallback; post only to a verified allowlisted parent origin, else drop; redact password, pin, currentPin, token, authorization in bodies and headers.
14. vite.config.ts (NB-15): remove cors: true and allowedHosts: true; allow only the session preview host via env.
15. server/settings.ts, src/views/ProfileView.tsx, README.md (NB-16): email change needs current password and uniqueness check and updates users.email and user_profiles.email in one transaction; password-less (dev preview) accounts cannot change email; update wording.
16. server/naira/bills.ts (NB-17): atomic stock/seat reservation (UPDATE ... WHERE stock >= ?) restored on reversal; validate return flight seats, route symmetry (back.from === out.to) and date (back.date >= out.date).
17. contracts/script/Create2Factory.sol and scripts/compass-deploy-helpers.ts (NB-07): effective salt keccak256(abi.encodePacked(msg.sender, salt)); computeAddress(deployer, salt, hash); update off-chain helper. Requires factory redeploy.
18. scripts/self-deploy.ts, scripts/compass-deploy.ts, tsconfig.json, package.json (NB-18, NB-19): process.cwd() instead of /home/user/app; resolve the missing chain-registry import (add package if public, else local type declaration) so typecheck is clean.
19. contracts/test/Create2Factory.t.sol (NB-21): Foundry tests for deploy, per-caller salt isolation, address prediction, double-deploy revert.
20. tests/audit/nb01-ledger.test.ts ... tests/audit/nb20-confirmations.test.ts: one bun:test file per behavior-testable finding on a temporary database, reproducing the PDF cases; `test` script in package.json.

Stage 2: Supabase Postgres
21. supabase/migrations/0001_init.sql: full schema; BIGINT timestamps, BOOLEAN flags, NUMERIC(78,0) amounts, identity ids, all unique/idempotency constraints, ledger immutability triggers, RLS on every table.
22. scripts/db-migrate.ts: ordered, idempotent migration runner with schema_migrations table.
23. server/db.ts: rewritten on `postgres`; async get/all/run/tx(fn) plus advisoryLock, uid, now; SSL; prepare:false for pooled connections.
24. All 49 server/** files: convert every DB call to async/await and ? placeholders to $n; enable type-aware no-floating-promises and no-misused-promises in .oxlintrc.json.
25. server/ledger.ts and server/queue.ts: advisory locks in writeEntry, SUM in SQL for balanceOf, SKIP LOCKED job claims.
26. server/security.ts: rate limiter backed by a Postgres counter table.
27. scripts/migrate-sqlite-to-supabase.ts: read-only SQLite source; dependency-ordered, idempotent (ON CONFLICT DO NOTHING), preserves ledger ids and idem_keys, resets sequences, --dry-run, final row-count and verifyLedger comparison.
28. .env docs and README.md: DATABASE_URL, TRUST_PROXY, TRUSTED_PROXY_HOPS; SQLite file kept as backup.
29. tests/audit/*: re-run on Postgres with a temp schema per run.

Stage 3: Next.js foundation
30. package.json: add next (React 19 if required; check connectkit/wagmi peers, use overrides if needed); scripts dev, build, start, worker.
31. next.config.ts, tsconfig.json: @server/* alias; allowedDevOrigins for the preview host only.
32. scripts/dev.ts: starts `bun --bun next dev -H 0.0.0.0 -p 5173` and the worker together (replaces the Vite plugin).
33. src/app/layout.tsx, src/app/providers.tsx: fonts, index.css, all providers, Toaster, Studio badge; pre-paint inline script for theme and text size.
34. src/tracing.ts, src/console-capture.ts initialised from a client-only component.

Stage 4: API and worker
35. src/app/api/[...path]/route.ts: GET/POST/PUT/PATCH/DELETE adapter to handle(), IP per TRUST_PROXY, body-size cap.
36. server/routes-all.ts: imports every route module once.
37. server/bootstrap.ts: idempotent seeding (seedAssets, seedTokens, removeStarterBalances) under an advisory lock.
38. worker/index.ts: queue, Arc and wallet monitors, agent, reconcile, session cleanup, leader advisory lock, job handlers; remove server/index.ts afterwards.
39. tests/api/*.test.ts: auth, orders, webhook signature, rate limiting through the route handler.

Stage 5: pages
40. src/app/(app)/layout.tsx: auth gate, Shell, Backdrop; AuthScreen when signed out; founder-only guard for /founder and /agent.
41. src/app/(app)/page.tsx plus exchange, crypto, wallet, activity, alerts, more, profile, settings, founder, agent page.tsx: 'use client' wrappers around src/views/*.
42. src/components/Shell.tsx, src/lib/nav.ts and go() callers: next/link and useRouter; Intent becomes query params (/crypto?screen=send, /exchange?side=sell, /settings?page=appearance, /exchange?order=<id>).
43. Remove src/main.tsx, src/App.tsx, index.html, vite.config.ts and Vite dependencies; update README.md and AGENTS.md.

### Build Sequence
Stage 1: audit fixes (pause for review at end)
1. Add DB_PATH override and bun:test setup; write failing tests first for NB-01, 02, 03, 04, 05, 06, 08, 09, 10, 11, 12, 13, 16, 17, 20.
2. Fix ledger and order engine (NB-01, 02, 03, 08, 09, 12).
3. Fix chain monitors and agent (NB-04, 05, 06, 20); run the log_index migration on a copy of the database first.
4. Fix token verification, destinations, HTTP, profile, bills and stock (NB-10, 11, 13, 16, 17, 21).
5. Fix frontend telemetry and dev server (NB-14, 15).
6. Fix the contract (NB-07), write Foundry tests, clean up scripts and typecheck (NB-18, 19, 21).
7. Run forge test, bun test, bunx tsc --noEmit and existing scripts/*-test.ts. Pause.

Stage 2: Supabase (pause after)
8. Local Postgres for development; write 0001_init.sql and db-migrate.ts.
9. Write async server/db.ts; convert server files in dependency order with the no-floating-promises lint rule enabled first.
10. Write the SQLite-to-Postgres migration; dry-run on data/fintech.db; run it; verify counts and verifyLedger().
11. Point DATABASE_URL at Supabase (once supplied); run migrations, data migration and full tests. Pause.

Stage 3: Next foundation (pause after)
12. Install Next; config, scripts/dev.ts, root layout and providers; boot an empty app on port 5173.

Stage 4: API and worker (pause after)
13. Catch-all route handler, routes-all.ts, bootstrap.ts; split the worker out of server/index.ts; verify /api/health, auth, an order, a webhook and rate limiting while the old Vite UI is still active. Pause.

Stage 5: pages and cleanup (pause after)
14. Build route pages and layout auth gate; convert navigation and intents; fix window/sessionStorage access for server rendering.
15. Remove Vite files and old entry points; update docs; run lint, typecheck, next build, all tests and a manual pass through every page in the preview.

### Done When
- [ ] Every NB-01 to NB-21 has a passing test (Foundry for the contract); bun test, forge test, bunx tsc --noEmit and lint are clean.
- [ ] A 10 ETH balance reads exactly and the ledger verifier reports no mismatches.
- [ ] A buy order without funding on a frozen wallet, or without a PIN, is rejected.
- [ ] A reversed order cannot be revived by a late webhook; no user wallet goes negative from a bank-payout reversal.
- [ ] Exchange and swap fees appear in sys:fees and match the founder dashboard.
- [ ] Spoofed pending hints or fake tokens cannot lock an order; two transfers in one transaction both record.
- [ ] A spoofed x-forwarded-for does not bypass rate limiting when TRUST_PROXY is off.
- [ ] The tracer never posts to '*' and never emits passwords or PINs.
- [ ] The Supabase schema applies cleanly, RLS is on for every table, and the data migration reports matching counts and a balanced ledger on both sides.
- [ ] The app runs as Next.js on Bun with /api/* served by a Next route handler and the queue, monitors and agent in the Bun worker; every screen has its own URL and survives reload and deep links.
- [ ] No Vite files, bun:sqlite imports or Bun.serve remain in the app; README documents setup, env vars and test commands.
- [ ] Each stage gate has been reviewed and approved by the user.

## Ready to build?
