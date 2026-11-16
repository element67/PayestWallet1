# NairaBridge

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Crypto-to-Naira exchange (sandbox). Bun API + SQLite in `server/`, React app in `src/`.
- Money moves ONLY in `server/orders.ts` (idempotent ledger in `server/ledger.ts`). The agent (`server/agent.ts`) classifies transactions and requests actions; the order engine re-checks policy.
- Live chain: Arc Testnet USDC (`server/chain/arc.ts`). Other assets: simulator (`server/chain/sim.ts`). Payments and vault releases are SANDBOX (`server/providers.ts`, `server/vault.ts`).
- `realMoney` is hard-coded false in `server/config.ts`. Do not enable without a licensed provider and custody signer.
- One process owns `data/fintech.db`: API, job queue, monitor and reconciler all run in `server/index.ts`.
- Rates are founder-configured integer kobo per whole unit (`assets` table); quotes lock a rate version.
- RPC: `server/rpc.ts` re-reads RPC_PROXY_* from .env; on 401 the monitor shows degraded and recovers by itself. Never swap to a public endpoint to bypass a 401.
- Crypto wallet: `server/wallet/` (networks catalog, keys, chains, service, monitor, routes). Per-user HD wallet, testnets only. Seed wrapped by WALLET_MASTER_KEY, bound to user id; only `withEvmAccount` decrypts. Separate from the Naira ledger and from exchange credits (`server/ledger.ts`). Send is EVM-only; Solana/Bitcoin are receive + balances. Swap/bridge/buy are intentionally not connected (see `/api/crypto/integrations`).
- Naira wallet: `server/naira/` (wallet+PIN, txns, pay engine, transfers, bills, providers, p2p, admin). Ledger is double-entry and immutable (`server/ledger.ts`, DB triggers); use `move()` for new flows, never edit `balances` directly. Funds are reserved to `sys:holding`, then settled or reversed. PAYMENT_MODE is SANDBOX only (`server/config.ts`). Naira funding = P2P sell orders with payout to wallet; `p2p_orders` mirrors the exchange order.
- Home/crypto ops: `server/cryptoOps.ts` (GET /api/home, tokens, sell/buy/p2p/swap/bridge + `crypto_ops` records with live status). Gas fee per chain = setting `gas_fee_ngn`, included in `fee_kobo` by `price()`. Exchange credits (ledger balances from buys/swaps) show on Home as sandbox rows. Bridge has no provider: it records a failed attempt.
- Balances are derived: `balanceOf()` sums confirmed `ledger_entries` (column `status`); the old `balances` table is no longer read or written. No starter balances exist; sandbox funds come only from the founder Test credit (`server/testCredit.ts`). `server/maintenance.ts` removed the old 100 USDC starter once.
- Token registry: `server/tokens/` (networks.ts static chain list, seed.ts candidates, verify.ts on-chain checks, service.ts, routes.ts). `ASSETS` in `server/wallet/networks.ts` is rebuilt from the active verified testnet deployments by `refreshAssets()` (call `onRegistryChange()` after any registry edit). Exchange rates/tradability stay in the `assets` table; registry tokens get a disabled row there. Sends fail closed without a founder-set limit.
- Section 12 of the original brief (development preview without login) was cut off; implemented as `DEV_PREVIEW=true` sandbox sign-in.

## Tech Stack

- Frontend: Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Share links

- Starter apps already ship `getShareBase`, `buildShareLink` and `installShareSync` in `src/lib/share.ts`; import them instead of rewriting them.
- Keep shareable state in the URL path or query, not in the `#fragment`.
- Never put a secret (private key, claim secret, seed phrase, session token, API key) in the URL path or query, encoded or not: every in-app path and query is mirrored to the visitor's studio.arc.io address bar and browser history and reaches servers. A bearer claim secret goes only in the `#fragment` appended to the share link (`` `${await buildShareLink('/claim')}#${secret}` ``) and is read from `location.hash` on load. A link to the app's own share URL shown inside the app must be copy-only or open in a new tab with `target="_blank" rel="noopener noreferrer"`.
- Build every link a user copies or sends with `buildShareLink()` from `src/lib/share.ts`.
- Keep the `installShareSync()` call in `src/main.tsx` when editing it; it keeps the Studio address bar in step with in-app navigation.
- Navigate inside the app with relative links.

## To Run

```bash
bun install
bun run dev
```

## Design system notes
- All colours are theme tokens (CSS variables) set by `src/lib/themes.ts` from three colours per theme. Never write a colour in a screen or component; use the Tailwind token classes (`bg-card`, `text-ink`, `bg-accent`, `border-outline`, ...).
- Anything inside a card (`.glass`, `.sticker`, `.on-card`) reads the card's own text colours. Status colours: `text-success/danger/warn` are the readable shade for the surface; solid `bg-success/danger/warn` fills use the vivid colour with `text-on-*`.
- Background artwork: `src/components/Backdrop.tsx` (three compositions shared across the themes).
- Theme API and profile API: `server/settings.ts`. After changing `tailwind.config.js`, restart the dev server.

## Type scale notes
- Font sizes are defined once in `tailwind.config.js` (rem x `--text-scale`; headlines use `--text-scale-h`). Use the Tailwind size names (`text-xs` is 14px at Small, `text-sm` is 16px). Never write a pixel font size in a component.
- `src/lib/textSizes.ts` holds the four sizes; `src/lib/textSize.tsx` loads, applies and saves the choice (`/api/settings/text-size`).
- `.truncate` wraps instead of cutting text off. Layout that must change with the size keys off `html[data-text=...]` in `src/index.css` (`.action-grid`, `.dash-split`).

## NairaSwap deployments (testnet)
Owner and treasury payout: 0x4674A1b673b4A9e682888d10a52509b6b88123C2 (user-supplied public address). Spec: contracts/NairaSwap-design.md.
- Arc Testnet: Treasury 0x9bf220b8d503b9f4b7c9a6e5e840e2c450e28913, Factory 0xa653656e3b725b1f46350e50abafa5f2a9934782, Router 0xfd47ab3e9b8bf87220f8dda5a76712dc7e9d753d (verified onchain: owner, feeTo, factory, payout).
- Ethereum Sepolia: Treasury 0x4acec8a3401fcb43a5cf7278e4c8142797631654, Factory 0xC8ADB16fBB1BAF2ce843BE7AC54c5479BB7B2cb4, Router 0x5a0C0Ea1F1Ba99e9dD3d64943006f7aF07B786a2 (verified onchain). The shared platform deploy failed 4 times on the Factory (ESTIMATION_ERROR), so the Factory and Router were deployed with a disposable funded key using forge create; ownership is the constructor owner (your address), so that key has no authority.
- Base Sepolia: Treasury 0x783d51839ba2ca0653cc666380e72002227517f2, Factory 0xc8103ba788f4344df46d4c15ad77733f526c973d, Router 0xd34c33d910676424e0c854b7600faa40e99b3f96 (verified onchain).
- AchSwap (third party, read-only quotes): see ACHSWAP_* in .env.
- Bridge: Circle CCTP via @circle-fin/app-kit, USDC only, Arc/Ethereum Sepolia/Base Sepolia, forwarding service (no destination gas). App-wallet transfers run server-side after a PIN (bridge_ops table); browser-wallet transfers run client-side.
- Vault watch addresses (public) are founder settings: vault_address_arc (EVM), vault_address_solana, vault_address_bitcoin. Solana/Bitcoin deposits are not auto-detected yet.
- Architecture (Next.js stage 4 done): the API runs inside Next.js (src/app/api/[...path]/route.ts imports server/app.ts). Background work (queue, chain monitors, agent, bridge sweep) runs in a separate Bun process, worker/index.ts, which takes a Postgres advisory lock so only one runs. server/index.ts is the standalone API plus worker for scripts/tests. The token catalog is held in memory and re-read every 30s in each process.
- Stage 5 done: each customer screen is a real route under src/app/(app)/ (/, /exchange, /crypto, /wallet, /activity, /alerts, /more, /profile, /settings), inside one shared client frame (src/AppFrame.tsx). Screen options travel in the address (/crypto?screen=send, /exchange?side=buy, /exchange?order=ID, /settings?settings=appearance). The admin area is separate at /admin. Vite files were removed. `next build` skips its own type check (run `bun run typecheck`).

