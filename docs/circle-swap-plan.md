# Plan: Circle swap for the Swap screen

Status: Phase 1 (Arc Testnet) is built. Phase 2 (mainnet) was not started: you chose to keep it testnet for now.

## What it adds
A fourth mode on the Swap screen, **Circle swap**, next to Exchange balances, Onchain swap and Pools. It swaps tokens Circle supports from the user's own app wallet, with a quote first, a transaction PIN to confirm, and a live status. The existing three modes are not touched.

## Tokens
Checked live today: Circle's quote service answers for these swaps on Arc Testnet.
- USDC to EURC and EURC to USDC
- USDC to cirBTC

Circle supports more tokens (USDT, PYUSD, DAI, USDE, WBTC, WETH, WSOL, WAVAX, WPOL and the native token) but only on mainnet chains, where real money moves. On Arc, Circle swaps accept only USDC, EURC and cirBTC.

## Phase 1: Arc Testnet (safe, recommended)
**Server (new, 3 files in `server/swap/`)**
- `chains.ts`: the allowed chain and token list, read from the installed App Kit so nothing is typed by hand.
- `service.ts`: quote (estimate only), review, start and status. The start step:
  - checks chain, token pair, amount and slippage;
  - checks the founder per-transaction limit and the paused flag, like Send and Bridge;
  - checks the balance and the Arc fee (paid in USDC from the same balance, so the amount plus fee must fit);
  - needs the 4-digit PIN and a signed, 2-minute confirmation that binds the amount and tokens;
  - uses an idempotency key, so a retry never swaps twice;
  - signs inside the existing wallet-key callback so the key never leaves memory;
  - always sets a slippage limit (default 1%, hard cap 3%) and always swaps to the user's own address.
- `routes.ts`: `GET /api/swap/config`, `POST /api/swap/quote`, `POST /api/swap/start`, `GET /api/swap/ops/:id`, `GET /api/swap/ops`.
- One new table (migration `0005_swap_ops.sql`): the swap record with status, amounts, fees and tx hash. No change to existing tables.
- Uses `@circle-fin/app-kit` and the Viem adapter, both already installed. No new packages.

**Screen (new, 2 components in `src/components/crypto/`)**
- `CircleSwap.tsx`: token pickers, amount, quote with fees, a notice that the swap runs through an outside provider (Circle or an aggregator such as LiFi) under that provider's terms, then Confirm with PIN and a status view.
- Mounted in `SwapHub.tsx` as the fourth mode. Nothing else in the screen changes.

**Tests**
- New `tests/audit/circle-swap.test.ts`: input checks, unknown token and chain refusal, same-token refusal, limit and paused guards, bad PIN, idempotent start, confirmation expiry and tampering.
- Re-run the existing swap, ledger and order tests.
- A live read-only check that quotes return for the three pairs. I will not run a real swap myself, per Circle's rules; the first real swap is yours, from the screen.

**Rough size:** 3 server files, 1 migration, 2 components, 1 test file, README note.

## Phase 2: mainnet tokens (only if you ask)
Adds the other tokens on Ethereum, Base, Arbitrum and the rest. Real funds, so it needs: your explicit go-ahead and the mainnet warning, a separate mainnet switch that stays off by default, a low per-swap cap, warnings above 100 USD, and your own review and operation outside Arc Studio. Solana swaps need a Solana signing path that the app wallet does not have for sending today, so they would be separate work.

## Risks and how they are handled
- Funds move: confirmed by quote, PIN and a signed short-lived confirmation; idempotent; slippage capped.
- A provider changes or is down: a clear error and no money taken; quotes are not trusted at start, the swap is re-checked.
- Existing swaps: untouched; the new mode only reads the same balances and limits.

## Decision needed
Phase 1 only (Arc Testnet: USDC, EURC, cirBTC), or Phase 1 now and Phase 2 later? Recommended: Phase 1.


## Decision recorded (not yet confirmed for mainnet)
You chose testnet plus mainnet, switchable by the founder with a confirmation step. Design:
- A new founder setting, "Swap network mode" (Testnet or Mainnet), stored with the other platform settings and audited. Testnet is the default and is what a fresh install uses.
- Switching in either direction opens a confirmation dialog that names what changes (the chains and tokens offered, and that mainnet swaps use real funds). The server also refuses the change unless the request carries the confirmation, so the toggle cannot be flipped by a stray call.
- In Testnet mode only Arc Testnet USDC, EURC and cirBTC are offered. In Mainnet mode the mainnet chains and the full Circle token list are offered, with a per-swap cap set by the founder, a warning above 100 USD, and the provider notice before every swap.
- There is no founder testnet/mainnet toggle in the app today: PAYMENT_MODE only accepts SANDBOX, and mainnet entries in the token registry are reference data that cannot be enabled. This would be the first one, so it is built as its own setting and does not change PAYMENT_MODE or the existing sandbox behaviour.
- Mainnet is not started until you confirm the notice in chat.
