# NairaBridge

A crypto-to-Naira and Naira-to-crypto exchange for Nigeria. Customers sell USDC, USDT, BTC or SOL for Naira, or buy them with Naira. A transaction agent watches the chain, checks every token and amount, and pays out as soon as the evidence is good. Founders manage rates, limits, liquidity and risk from a dashboard.

Built with [Arc Studio](https://studio.arc.io)

## Important: sandbox only

No real money moves in this version. Naira collection and payouts use a sandbox payment provider, crypto vault releases are simulated, and BTC, SOL and USDT deposits are simulated. USDC on Arc Testnet is the one live chain adapter: a real testnet transfer to the configured vault address is detected and processed. Everything simulated is labelled in the app. Real-money mode stays off until a licensed payment provider, identity verification and a custody signer are integrated.

## Home, tokens and the P2P exchange

The home screen is one split dashboard card (crypto on the left, Naira on the right, each with its own eye icon), the Payest P2P Exchange card, eight actions (Send, Receive, Transfer, Exchange, Buy, Sell, Swap, Bridge) and a single "Your assets" list with Naira first and only assets that have a balance. The Crypto page lists the tokens a person has added or holds and every other supported token with an Add button; adding is saved per user. Buy, Sell, P2P exchange and Swap each have their own validated, idempotent endpoint and leave a record with a live status (pending, verifying, completed, failed). Founders set a gas fee per chain (Founder, Naira wallets, Fees) that is added to every buy, sell, exchange and swap on that chain. Swaps move value between exchange balances at the founder's rates (sandbox ledger). Bridge requests are validated and recorded, but no bridge provider is connected, so nothing moves. The dashboard card is one request to a balance endpoint: the server converts everything with the founder's USDC rate in integer math, shows crypto in US dollars by default (or Naira, saved per user), and keeps testnet and sandbox figures labelled. Balances are never stored or typed anywhere: they are the sum of confirmed entries in the immutable ledger, and a new wallet starts at zero. Founders can add sandbox funds with the audited Test credit tab. Tests: `bun scripts/home-test.ts`, `bun scripts/balance-test.ts`, `bun scripts/ledger-test.ts`.

## Design, themes, Profile and Settings

The whole app uses one bold, flat "sticker" style: thick dark outlines, hard offset shadows, rounded pill buttons, big heavy headlines and a graphic background of abstract shapes (blobs, rings, torn paper edges, tape strips) with a faint halftone dot texture. Phone screens come first; the bottom tab bar is a floating pill.

- **Themes:** ten colour themes (Cobalt Lime is the default). A theme is just three colours (background, card, button); text colours, outlines, status colours and the background artwork are all derived from them, and text is always chosen for contrast. No screen or component carries a colour of its own. Pick one under More, Settings, Display, Appearance, or with the sun icon in the top bar. It changes everywhere at once and is saved to your account, so it follows you to any device. A local copy makes the right colours show instantly before the server answers.
- **Profile:** More, Profile shows your initials avatar, name, email, phone, member since and verification status, with an Edit profile form. The email there is a contact email: the email you sign in with does not change. Names and Nigerian mobile numbers stay in step with the Naira wallet.
- **Settings:** Display, Notifications, Security (PIN, signed-in devices), Linked accounts (payout bank accounts) and Help and support. Everything that used to be on the old Settings page is still there.
- **API (signed-in user only, own data only):** `GET/PUT /api/settings/appearance` (only the ten known theme ids are accepted) and `GET/PUT /api/profile` (name, email and phone are validated). A missing settings or profile record is created automatically. Tables: `user_settings`, `user_profiles`.
- Tests: `bun scripts/design-test.ts` (needs the API running).

## Heavy text and Text size

All text uses one ultra-heavy font (Archivo Black) with a thin outline in the letters' own colour, and nothing is faded, so balances, names and buttons stay easy to read in every theme. Long text wraps onto a new line instead of being cut off. Only hashes and addresses use a bold monospace face.

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
- Development preview: with `DEV_PREVIEW=true` you can enter as a customer or founder without logging in. It uses sandbox money and is disabled when the flag is off.

## Tech stack

React 18, Vite, TypeScript, Tailwind CSS, wagmi and viem for wallets. Bun server with SQLite for the API, job queue, blockchain monitor and transaction agent.

## Development

Prerequisites: Bun.

```bash
bun install
bun run dev        # web app on :5173, also starts the API on :3001 if it is not running
bun run server     # API only
bun run check      # lint and typecheck
bun scripts/smoke.ts   # end-to-end sandbox flows against the running API
```

The API stores data in `data/fintech.db` (ignored by git).

### Environment variables

| Name | Purpose |
| --- | --- |
| `APP_ENCRYPTION_KEY` | 64 hex characters. Encrypts bank account numbers at rest. Required. |
| `WEBHOOK_SECRET` | Signs and verifies payment webhooks. Required. |
| `PAYMENT_MODE` | Optional. Only `SANDBOX` is supported; any other value stops the server. |
| `WALLET_MASTER_KEY` | 64 hex characters. Wraps every wallet seed phrase. Required. Back it up separately; losing it makes wallets unrecoverable. |
| `RPC_URL_Ethereum_Sepolia`, `RPC_URL_Base_Sepolia` | Optional. Your own RPC provider URL for that network. The registry's public RPC can rate-limit. |
| `DEV_PREVIEW` | `true` enables sign-in without credentials (sandbox only). |
| `PORT` | API port, default 3001. |
| `FOUNDER_EMAIL` | Account registered with this email becomes the founder. |
| `REAL_MONEY_ENABLED` | Reserved. Has no effect until live providers exist. |
| `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` | Optional outside Arc Studio. Provisioned by Arc Studio for Arc Testnet RPC. Without them the public Arc Testnet RPC is used. |

### First run

1. Open the app and choose "Enter as founder" (development preview) or register with `FOUNDER_EMAIL`.
2. Under Founder, Limits and fees, set the Arc Testnet vault address (an address you control, watch only).
3. Under Rates, publish your own rates. Seeded rates are placeholders.
