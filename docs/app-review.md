# Payest Wallet: app review (19 November 2026)

Read-only review. Nothing in the app was changed to produce it. Where a point comes from a command I ran, it says so.

## Health today
- Lint and typecheck: 0 errors, 0 warnings.
- Tests: 127 pass, 0 fail. The production build succeeds.
- App server and background worker are both running. `/api/health` answers.
- A scan of the repository for pasted keys and tokens found nothing. `.env`, recovery files and `.env.*` are git-ignored, and `.env.example` is allowed through.
- The latest commit on the connected repository is "Payest". Twenty-six files have local changes since then and are not pushed anywhere.

## What is solid
- Money safety: PIN on every send, swap, bridge and transfer, with a lockout; signed 2-minute confirmations; per-token limits; platform pause and wallet freeze; idempotency keys; audit log.
- Keys: seed phrases are encrypted per user and never returned by any API. Passwords and PINs use Argon2id. Sessions store only a token hash.
- Ledger and history: each swap, bridge and exchange order is written once, with duplicate rows hidden.
- Browser headers (CSP, HSTS, frame protection) are set in production.
- Swap and bridge rebuilt behind one provider interface, with a router that skips a failed provider.

## Findings, most important first

### High
1. **Dependency vulnerabilities.** `bun audit` reports 41 (18 high, 17 moderate, 6 low). The ones I read were transitive, through the Circle and Solana SDKs (for example `stream-json` under `@solana/web3.js`): denial-of-service and prototype-pollution classes. I only read the tail of the output, so the full high list still needs a look. Fix path: `bun update`, then re-run tests, or pin patched versions with overrides.
2. **One master key and no second sign-in step.** `WALLET_MASTER_KEY` in the environment decrypts every wallet, and there is no two-step login. Both are already known. The vault move and 2FA are the biggest remaining security items before any real money.
3. **LI.FI and AchSwap have never run against the real APIs.** They are mainnet-only and no keys were available. Their parsing follows the docs and unit tests cover the safety checks, but nothing else is proven. They stay off behind `ENABLE_MAINNET_INTEGRATIONS=false`.
4. **Two networks are not being watched reliably.** The deposit monitor reports Ethereum Sepolia and Polygon Amoy as degraded because their public endpoints reject the log query. Deposits there can be missed. Fix: set a dedicated RPC URL per chain.

### Medium
5. **Request limiter is in memory.** It resets on every server restart and is not shared between servers. Use a database or Redis-backed limiter before running more than one instance.
6. **CSP still allows inline scripts.** Tightening it needs a per-request nonce.
7. **Worker CPU.** The background worker has used about 42 minutes of CPU in roughly five hours (about 14%). The polling loops should back off when nothing is happening.
8. **Leftover processes.** Two stale Next build workers are still running and holding about 230 MB. Harmless but wasteful on a small machine.
9. **Heavy pages.** First-load JavaScript is 527 to 560 kB on Crypto, Exchange, Wallet and More. The wallet libraries load everywhere. Loading them only where a browser wallet is used would cut it.
10. **Exchange rates are placeholders.** The founder must publish real rates. EURC has no rate, so its Naira value reads "No rate set".

### Low and housekeeping
11. **Dead code.** `src/components/crypto/SwapScreen.tsx` (the old exchange-balances swap screen) and `src/views/Founder.tsx` are not used by anything. The swap branch of `TradeScreen` is also unused now that Swap runs on Uniswap. The NairaSwap Solidity contracts, their tests and deployment metadata remain in `contracts/`, with no app code using them.
12. **Packages that appear unused:** `@circle-fin/modular-wallets-core`, `@circle-fin/user-controlled-wallets`, `@circle-fin/w3s-pw-web-sdk`, `@solana/kit`, `clsx`, `tailwind-merge`. Confirm before removing, because a few may be reached indirectly.
13. **Old tables kept.** `swap_ops`, `bridge_ops` and `dex_ops` hold archived records and are still read by the Uniswap tab (`swap_ops`) and by history backfill. Decide whether to retire the other two.

## Product gaps to be aware of
- Naira payouts, bank transfers and identity checks are simulated. Real money stays off until a licensed provider, KYC and an independent audit exist.
- The Uniswap tab reads Uniswap v3 pools directly on Ethereum Sepolia. It does not use the Uniswap Trading API, which needs a key.
- Circle swaps and bridges charge no service fee of ours. The fee wallet and basis points apply to LI.FI and AchSwap only.
- KyberSwap appears in the "Powered by" row but has no adapter behind it.
- I could not read rendered text in my sandbox browser because it cannot load fonts. Layout and wording were checked by measuring the page, so a manual pass on a real phone is still worth doing.

## Suggested order of work
1. Update or pin vulnerable dependencies and re-run tests.
2. Give Ethereum Sepolia and Polygon Amoy dedicated RPC URLs.
3. Remove the dead code and unused packages.
4. Add two-step login and move the master key to a vault.
5. Replace the in-memory limiter, add worker back-off, split the wallet libraries out of the shared bundle.
6. Real-API checks of LI.FI and AchSwap with small mainnet amounts, after the notice and an independent review.
