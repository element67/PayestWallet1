# NairaBridge

A crypto-to-Naira and Naira-to-crypto exchange for Nigeria. Customers sell USDC, USDT, BTC or SOL for Naira, or buy them with Naira. A transaction agent watches the chain, checks every token and amount, and pays out as soon as the evidence is good. Founders manage rates, limits, liquidity and risk from a dashboard.

Built with [Arc Studio](https://studio.arc.io)

## Important: sandbox only

No real money moves in this version. Naira collection and payouts use a sandbox payment provider, crypto vault releases are simulated, and BTC, SOL and USDT deposits are simulated. USDC on Arc Testnet is the one live chain adapter: a real testnet transfer to the configured vault address is detected and processed. Everything simulated is labelled in the app. Real-money mode stays off until a licensed payment provider, identity verification and a custody signer are integrated.

## Home, tokens and the P2P exchange

The home screen is one split dashboard card (crypto on the left, Naira on the right, each with its own eye icon), the Payest P2P Exchange card, eight actions (Send, Receive, Transfer, Exchange, Buy, Sell, Swap, Bridge) and a single "Your assets" list with Naira first and only assets that have a balance. The Crypto page lists the tokens a person has added or holds and every other supported token with an Add button; adding is saved per user. Buy, Sell, P2P exchange and Swap each have their own validated, idempotent endpoint and leave a record with a live status (pending, verifying, completed, failed). Founders set a gas fee per chain (Founder, Naira wallets, Fees) that is added to every buy, sell, exchange and swap on that chain. Swaps move value between exchange balances at the founder's rates (sandbox ledger). The Bridge moves USDC between Arc Testnet, Ethereum Sepolia and Base Sepolia through Circle's cross-chain transfer, signed with your app wallet PIN or a browser wallet. The dashboard card is one request to a balance endpoint: the server converts everything with the founder's USDC rate in integer math, shows crypto in US dollars by default (or Naira, saved per user), and keeps testnet and sandbox figures labelled. Balances are never stored or typed anywhere: they are the sum of confirmed entries in the immutable ledger, and a new wallet starts at zero. Founders can add sandbox funds with the audited Test credit tab. Tests: `bun scripts/home-test.ts`, `bun scripts/balance-test.ts`, `bun scripts/ledger-test.ts`.

## Design, colours, Profile and Settings

The whole app uses one clean, flat fintech style: solid flat cards with no outlines or shadows, plain line icons, one sans-serif typeface and muted status tags. A liquid glass effect (blur and a soft highlight) is used only on the top bar, the bottom tab bar, sheets, pop-ups and the token picker. Buttons and rows give a quick, subtle press response; nothing else moves on its own. Phone screens come first; the bottom tab bar is a floating pill.

- **Colours:** a bright white page, light grey-blue cards and sheets set apart by a clear thin line, near-black text (`#050912`) and one blue (`#1558C9`) used only for the main buttons and the active tab. Text and icons are black on the bright theme and white on dark. Status badges keep their own green, red and amber because they carry meaning.
- **Light and Dark:** the app always opens bright, even if your device is set to dark. The moon and sun button in the top bar switches mode, and More, Settings, Display, Appearance has the same switch. Dark mode (charcoal page, white text) is only used when you choose it, and the choice is remembered on that device.
- **Top bar:** one compact row with your picture and "Welcome back" (tap it to open your profile), then wallet connect, the Light/Dark switch, Help, the payment QR scanner and the notification bell. Help opens the AI support agent, the official Telegram community, contact support and the FAQs. The scanner reads a wallet address QR code with the camera (or from a picture) and opens Send with the address filled in; you still review and confirm every payment. Logout moved to More, Settings, Logout and asks you to confirm first.
- **Profile:** More, Profile shows your picture (upload, change or remove it) or your initials avatar, name, email, phone, member since and verification status, with an Edit profile form. Changing the email there also changes the email you sign in with, so it asks for your current password and refuses an email another account already uses (preview accounts with no password cannot change it). Names and Nigerian mobile numbers stay in step with the Naira wallet.
- **Settings:** Display, Notifications, Security (PIN, signed-in devices), Linked accounts (payout bank accounts) and Help and support. Everything that used to be on the old Settings page is still there.
- **API (signed-in user only, own data only):** `GET/PUT /api/profile` (name, email and phone are validated). A missing settings or profile record is created automatically. Tables: `user_settings`, `user_profiles`.
- Tests: `bun scripts/design-test.ts` (needs the API running).

## Text and Text size

All text uses one heavy, clean sans-serif typeface (Inter, weights 600 to 900) in high-contrast colours, with headlines and balances at the heaviest weight, so figures, names and buttons stay easy to read. Line icons are drawn thicker and rounded so they stay crisp. Stacked blocks have extra space between them. Long text wraps onto a new line instead of being cut off. Only hashes and addresses use a monospace face.

- **Text size:** More, Settings, Display, Text size. Four sizes: Small (100%), Medium (115%, the default), Large (130%) and Extra large (150%). There is a live preview, A- and A+ buttons, four tap buttons and a Reset to default button. The whole app changes at once and the choice is saved to your account, so it follows you to any device. A local copy makes the right size show before the server answers.
- At Small the smallest text is 14px and body text is 16px; everything else scales from that. The only text under 14px is the bottom tab bar labels (12px), because five labels share one pill.
- At Large and Extra large the quick actions go two across and the Crypto and Naira balance card stacks so figures keep their room.
- **API (signed-in user only, own data only):** `GET/PUT /api/settings/text-size` (`small`, `medium`, `large`, `xlarge`; anything else is refused). It lives in the `text_scale` column of `user_settings`; a missing row is created with `medium`.
- Tests: `bun scripts/textsize-test.ts` (needs the API running).

## Token registry

Tokens live in the database, not in the code: a `tokens` table (symbol, name, decimals, logo, active) and a `token_networks` table (contract address, chain id, testnet or mainnet, verified, active) cover Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain and Arc. The 15 tokens are USDC, USDT, DAI, ETH, WETH, WBTC, BNB, POL, LINK, UNI, AAVE, ARB, OP, EURC (the euro stablecoin) and cbBTC, plus the existing SOL and BTC. Every contract is checked on-chain (code exists, symbol and decimals match) before it can be used, mainnet entries are reference data that cannot be enabled in sandbox mode, and BNB Chain has no testnet because none is in the chain registry. Founders manage the registry in Founder, Tokens. Wallet balances, Receive, Send, Swap, Bridge, Buy and Exchange all read tokens from the API, and a searchable picker with a Popular section is used wherever you choose a token. A token needs a founder-set exchange rate before it can be traded, and a send limit (Founder, Limits and fees, Crypto wallet policy) before it can be sent. Tests: `bun scripts/tokens-test.ts`.

## Naira wallet (sandbox)

A full Naira wallet with a unique sandbox virtual account number, a 4-digit transaction PIN, bank and NairaBridge-user transfers with name verification, and bill payments (airtime, data, electricity, cable TV, water, internet, education), flights and shopping. Funding is crypto-to-Naira only (USDC, USDT, BTC, SOL): the wallet is credited after the deposit is verified, never from a claim made by the app. Every movement is a balanced, immutable double-entry ledger record, payments are reserved and automatically reversed if a provider fails, and receipts can be shared. The founder panel (Naira wallets tab) shows wallets and ledgers, transactions, P2P deposits, bill orders, fees, limits, reviews, freezes and an audit trail, and can only correct money through audited ledger movements.

Everything runs in SANDBOX mode: bank, telecom, utility, airline and shop providers are clearly labelled simulations behind small adapter interfaces (`server/naira/providers.ts`), so a production provider can replace them later. USDC on Arc Testnet is watched live; USDT, BTC and SOL deposits use a labelled simulated network. Tests: `bun scripts/naira-test.ts` (about 6 minutes, it waits out rate-limit windows), `bun scripts/exchange-test.ts`, `bun scripts/wallet-test.ts`.

## Crypto wallet (testnets)

Every user gets their own wallet with real addresses (BIP-39 seed, standard derivation) on Arc Testnet, Ethereum Sepolia, Base Sepolia, Solana Devnet and Bitcoin Testnet4. Balances are read from the chains, incoming transfers are detected by background monitors, and unverified tokens are flagged and never counted. Sending is live on the three EVM networks (native ETH and USDC); Solana and Bitcoin support receiving and balances. Seed phrases are encrypted with `WALLET_MASTER_KEY`, decrypted only inside the signing call, and never returned by any API. Swap, bridge and card purchases are not connected yet and are shown as such.

Operator seed recovery: `bun scripts/wallet-recovery.ts <userId> --i-understand` in a trusted terminal. Back up `WALLET_MASTER_KEY` separately from the database. Wallet checks: `bun scripts/wallet-test.ts`.

## What you can do

- Customers: sell or buy crypto with an exact quote, track each exchange live, keep a Naira wallet, withdraw Naira to a saved bank account or crypto to their own address (daily limit applies), save bank accounts, see alerts, switch light and dark mode.
- Founder: see volume, fees and liquidity, publish exchange rates, set fees and limits, manage users, review held transactions, resolve alerts, read the audit log.
- AI monitor: live agent status, networks watched, detection and settlement times, recent decisions, fake tokens caught.
- Sign-in: everyone signs in with an email (or username) and password. A founder account is created on first start from `FOUNDER_EMAIL` and `FOUNDER_PASSWORD`.

## Tech stack

Next.js 15 (App Router) with React 19, TypeScript, Tailwind CSS, wagmi and viem for wallets. A Bun server runs the API, job queue, blockchain monitors and transaction agent. Data lives in Postgres (Supabase).

## Development

Prerequisites: Bun.

```bash
bun install
bun run dev        # Next.js app on :5173 (it serves the API under /api) plus the background worker
bun run build      # production build of the web app (run `bun run typecheck` separately)
bun run start      # serve the production build on :5173 (run `bun run worker` beside it)
bun scripts/db-migrate.ts   # create or update the database tables
bun run worker     # background worker only: job queue, chain monitors, transaction agent (one runs at a time)
bun run server     # standalone API plus worker on :3001, used by the scripts/*-test.ts checks
bun run check      # lint and typecheck
bun scripts/flows-test.ts   # drives receive, send, exchange, P2P, swap, bridge and transfers through the API (needs an API with DEV_PREVIEW=true, ideally on a throwaway schema: DB_SCHEMA=e2e DEV_PREVIEW=true PORT=3002 bun server/index.ts, then API=http://127.0.0.1:3002)
bun test           # security regression tests (in-memory database, no network)
forge test         # contract tests (Create2Factory)
bun scripts/smoke.ts   # end-to-end sandbox flows against the running API
```

The API stores data in Postgres. To bring an older local SQLite file (`data/fintech.db`) across, run `bun scripts/migrate-sqlite-to-supabase.ts --dry-run` and then without `--dry-run`. It never changes the SQLite file and stops if any balance differs.

### Environment variables

| Name | Purpose |
| --- | --- |
| `APP_ENCRYPTION_KEY` | 64 hex characters. Encrypts bank account numbers at rest. Required. |
| `WEBHOOK_SECRET` | Signs and verifies payment webhooks. Required. |
| `PAYMENT_MODE` | Optional. Only `SANDBOX` is supported; any other value stops the server. |
| `WALLET_MASTER_KEY` | 64 hex characters. Wraps every wallet seed phrase. Required. Back it up separately; losing it makes wallets unrecoverable. |
| `RPC_URL_Ethereum_Sepolia`, `RPC_URL_Base_Sepolia` | Optional. Your own RPC provider URL for that network. The registry's public RPC can rate-limit. |
| `FOUNDER_PASSWORD` | Password (10+ characters) for the founder account created on first start. The account's username is `founder`. It is never overwritten once the account exists. |
| `DEV_PREVIEW` | Optional, off by default. `true` enables a login-free test endpoint used only by the `scripts/*-test.ts` checks. Leave it off. |
| `PORT` | Port of the standalone server (`bun run server`), default 3001. |
| `TRUST_PROXY` | `true` only when a reverse proxy you control overwrites `X-Forwarded-For`. Otherwise the header is ignored, so callers cannot fake their IP for rate limits and audit logs. |
| `TRUSTED_PROXY_HOPS` | Optional. How many proxies sit in front of the server (default 1). Only used when `TRUST_PROXY=true`. |
| `ALLOWED_HOSTS` | Optional. Comma-separated host names the dev server accepts. Unset allows any host (needed for the Arc Studio preview). |
| `DATABASE_URL` | Required. Postgres connection string (Supabase: Project settings, Database, direct or session connection). Server side only, never put it in a `NEXT_PUBLIC_` variable. |
| `DATABASE_SSL` | Optional. `false` turns off SSL for a local Postgres. Remote databases use SSL by default. |
| `ACHSWAP_FACTORY`, `ACHSWAP_ROUTER`, `ACHSWAP_WRAPPED` | Addresses of the AchSwap V2 factory, router and wrapped USDC on Arc Testnet, used for read-only onchain quotes (`POST /api/dex/quote`). |
| `ENABLE_MAINNET_INTEGRATIONS` | Optional, `false` by default. While it is not `true`, the Swap screen runs on Uniswap only: Circle swaps, LI.FI and AchSwap stay switched off (their code stays in place). Set `NEXT_PUBLIC_ENABLE_MAINNET_INTEGRATIONS` to `true` as well to show their logos in full color. |
| `KIT_KEY` | Optional. Circle App Kit key, server side only. Circle swaps and bridges also run without one. |
| `LIFI_API_KEY` | Optional. LI.FI key for a higher rate limit, server side only. |
| `LIFI_INTEGRATOR` | Optional. Your integrator name sent to LI.FI (default `nairabridge`). |
| `LIFI_ALLOWED_TARGETS` | Mainnet only. Comma-separated LI.FI contract addresses a LI.FI transaction may target. Until it is set, LI.FI trades are refused. |
| `ACHSWAP_API_KEY` | Mainnet only. AchSwap Developer API key, server side only. Without it AchSwap is skipped. |
| `ACHSWAP_EXECUTOR` | Optional. Overrides AchSwap's route executor address if AchSwap publishes a new one. |
| `SUPPORT_AI_URL`, `SUPPORT_TELEGRAM_URL`, `SUPPORT_EMAIL` | Optional. The Help channels: an https address for the AI support agent, the official Telegram community (https://t.me/...) and the support email. A channel that is not set shows as "Not set up yet". |
| `ALLOWED_DEV_ORIGINS` | Optional. Extra hosts allowed to load the Next.js dev server (the Arc Studio preview hosts are built in). |
| `FRAME_ANCESTORS` | Optional. Comma-separated https addresses of sites allowed to show this app in a frame (for example `https://app.example.com`). Arc Studio's own preview hosts are built in; every other site is refused. |
| `NEXT_PUBLIC_TRACE_PARENT_ORIGINS` | Optional. Extra origins allowed to receive trace telemetry when the app runs inside a frame. |
| `FOUNDER_EMAIL` | Account registered with this email becomes the founder. |
| `REAL_MONEY_ENABLED` | Reserved. Has no effect until live providers exist. |
| `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` | Optional outside Arc Studio. Provisioned by Arc Studio for Arc Testnet RPC. Without them the public Arc Testnet RPC is used. |

### First run

1. Set `FOUNDER_EMAIL` and `FOUNDER_PASSWORD`, start the app, and sign in with that email (or the username `founder`).
2. Under Founder, Limits and fees, set the Arc Testnet vault address (an address you control, watch only).
3. Under Rates, publish your own rates. Seeded rates are placeholders.

## Swap and bridge

The Crypto tab's Swap and Bridge screens run on one module with a common provider interface (quote, approval check, execute). Each provider has its own adapter, and the server, never the browser, chooses between them:

- **Circle App Kit** is first for USDC and EURC bridges (native burn and mint, no wrapped tokens, Fast or Standard speed with the fee difference shown, resumable if interrupted) and for stablecoin swaps on Arc. On the test network it swaps USDC, EURC and cirBTC on Arc Testnet and bridges between 16 test networks.
- **AchSwap** handles other tokens on Arc mainnet (swaps only).
- **LI.FI** handles bridges and swaps Circle does not cover, on mainnet.
- Each provider that supports a route is asked at once. One that fails, times out or does not support the route is skipped, and the screen shows the recommended quote and the alternatives.

Before anything is signed the customer sees a summary (tokens, amounts, networks, fees, estimated time, slippage, provider) and must confirm with their transaction PIN. Chains and tokens come only from the server's own lists, the output always goes to the customer's own address, the founder's per-trade limit applies, and each trade is recorded with every step so a bridge shows approve, burn, attestation and mint and can be resumed. The founder sets Testnet or Mainnet (with a confirmation) and the service fee (0 to 1%, paid by LI.FI and AchSwap in the same transaction) in the admin Onchain panel. LI.FI and AchSwap work on mainnet only, and a mainnet token needs a per-trade limit set by the founder.

The Swap screen is now a single card (From token, Amount with your balance, flip, To token, a live "You receive") that always runs on Uniswap, with a quiet "Powered by" row of provider logos under it (Uniswap in full color, the others grayscale until mainnet, driven by `src/lib/providers.ts`). The older **Exchange balances** (swapping the Naira exchange's balances at founder rates) and a **Uniswap** tab for Uniswap v3 swaps on Ethereum Sepolia between USDC, EURC, WETH, LINK and UNI. Uniswap shows the best pool and fee tier, price impact (a warning above 1%, blocked above 5%), the minimum you receive and the network fee, with slippage never above 1% and a 20-minute deadline.

History (Crypto tab) lists every deposit, send, Circle swap and bridge. A swap or bridge appears as two entries, what you paid and what you received (for example USDC and EURC), each with its transaction link, and balances refresh as soon as the transfer finishes. The background monitor that detects incoming USDC, EURC and other token deposits now reads the chain in larger chunks, so fast chains such as Arc stay up to date, and if it was ever stopped for a long time it resumes from the most recent 30,000 blocks instead of replaying everything. On Home, each onchain asset shows its network logo next to the network name. USDC you hold on a bridge network the wallet has no balance list for (HyperEVM, Monad, Linea, Unichain, Avalanche Fuji and the others) is listed under "USDC on other networks" on Home and in the Crypto tab, with a button that opens the Bridge on that network so you can move it back. Swaps, liquidity changes and bridges made before History recorded them are added automatically when the background worker starts.

## Admin dashboard

Founders have a separate admin area at `/admin`, with its own sign-in, layout and navigation. It is closed to anyone who is not a founder. It monitors users, orders, the Naira wallets, ledger health, alerts and the audit log, the job queue and chain monitors, the AI transaction agent, and the exchange and bridge activity. Rates, limits, tokens and test credit are managed there too. The founder account is created from `FOUNDER_EMAIL` and `FOUNDER_PASSWORD`.

- First-time payout hold: a payout of NGN 200,000 or more to a destination you have not used before (outside crypto address, bank account, bank transfer) waits 1 hour for tier 2 accounts and 24 hours otherwise. You can cancel it with your PIN; founders can release or cancel it in the admin Held payouts section. Thresholds and hours are adjustable in Limits, fees and vaults.

## Browser security headers

In production every page is served with a Content Security Policy (only this app's own scripts, styles and images plus Google Fonts, secure connections only, no plugins, no foreign frames), Strict-Transport-Security, no content-type guessing, a limited referrer, and a permissions policy that allows the camera only for the app's own QR scanner. Other sites cannot put the app in a frame, which prevents click-jacking. The development server skips the Content Security Policy because hot reload needs it.
