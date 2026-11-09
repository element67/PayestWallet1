/**
 * Wallet monitors. They read real chain data, record what they see, and hand every observation to the
 * transaction agent's rules (token authenticity, unsupported tokens, failures). They never sign or move funds.
 *  - EVM: ERC-20 Transfer logs to any wallet address (all token contracts, so fake tokens are seen), native transfers
 *    by block scan where gas is not USDC, plus receipt tracking for pending sends.
 *  - Solana devnet: new signatures per address. Bitcoin Testnet4: mempool and confirmed transactions per address.
 */
import { erc20Abi, getAbiItem, type Hash } from 'viem'
import { alert, all, get, notify, now, run, uid } from '../db'
import { scrub } from '../rpc'
import { btcApi, evmClient, solanaRpc } from './chains'
import { allAddresses } from './keys'
import { ASSETS, NETWORKS, getNetwork, verifiedTokens, type NetworkDef } from './networks'
import { syncUser, walletDecision } from './service'

const transferEvent = getAbiItem({ abi: erc20Abi, name: 'Transfer' })

function state(net: string, status: string, o: { head?: number | bigint; last?: number | bigint; ms?: number; error?: string | null } = {}) {
  run(
    `INSERT INTO monitor_state(chain,status,last_block,head_block,last_poll_at,poll_ms,error,mode) VALUES (?,?,?,?,?,?,?, 'live')
     ON CONFLICT(chain) DO UPDATE SET status=excluded.status,last_block=COALESCE(excluded.last_block,last_block),head_block=COALESCE(excluded.head_block,head_block),last_poll_at=excluded.last_poll_at,poll_ms=COALESCE(excluded.poll_ms,poll_ms),error=excluded.error`,
    `wallet:${net}`, status, o.last === undefined ? null : Number(o.last), o.head === undefined ? null : Number(o.head), now(), o.ms ?? null, o.error ?? null,
  )
}
const cursor = (k: string) => get<{ value: string }>('SELECT value FROM wallet_cursors WHERE key=?', k)?.value ?? null
const setCursor = (k: string, v: string) => run('INSERT INTO wallet_cursors(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v)

interface Seen {
  userId: string; network: NetworkDef; tokenAddress: string | null; symbol: string | null; assetKey: string | null; amount: bigint
  from: string; to: string; hash: string; block: number | null; confirmations: number; status: 'pending' | 'confirmed'
}

/** Records an incoming transfer once, and applies the agent's authenticity rules. */
function recordIncoming(s: Seen) {
  const dupe = get('SELECT 1 FROM wallet_txs WHERE network=? AND tx_hash=? AND user_id=? AND type=\'received\'', s.network.id, s.hash, s.userId)
  if (dupe) return
  const verified = s.assetKey !== null
  const id = uid('wtx')
  run(
    `INSERT INTO wallet_txs(id,user_id,network,asset_key,token_ref,symbol,type,amount,from_addr,to_addr,tx_hash,status,verdict,block_number,confirmations,risk_score,risk_flags,detected_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, s.userId, s.network.id, s.assetKey, s.tokenAddress, s.symbol, 'received', s.amount.toString(), s.from, s.to, s.hash, s.status,
    verified ? 'genuine' : 'unverified_token', s.block, s.confirmations, verified ? 0 : 90, JSON.stringify(verified ? [] : ['unverified_token']), now(), now(), now(),
  )
  if (verified) {
    walletDecision('receive', `Incoming ${s.symbol} detected on ${s.network.name} (${s.status})`, { txId: id, reasons: ['verified_contract_or_native', `${s.confirmations} confirmations`] })
    notify(s.userId, 'order', 'Incoming transfer detected', `${s.symbol} received on ${s.network.name}. Status: ${s.status}.`)
    void syncUser(s.userId)
  } else {
    walletDecision('verify', 'REJECT: token is not in the verified catalog. Not counted in balances.', { txId: id, score: 90, reasons: ['unverified_token', `contract ${s.tokenAddress ?? 'unknown'}`] })
    alert('warning', 'wallet_unverified_token', 'Unverified token received', `${s.network.name}: contract ${s.tokenAddress} sent to your wallet (tx ${s.hash}). It is not counted in your balances. Do not interact with it.`, s.userId)
    notify(s.userId, 'security', 'Unverified token received', 'A token that is not on our verified list arrived in your wallet. It is not counted in your balance. Do not interact with it.')
  }
}

/* ---------- EVM ---------- */
async function scanEvm(net: NetworkDef) {
  const started = now()
  const client = evmClient(net.id)
  const wallets = allAddresses('evm')
  const head = await client.getBlockNumber()
  if (wallets.length === 0) return state(net.id, 'idle', { head, error: 'No wallets yet', ms: now() - started })
  const byAddr = new Map(wallets.map((w) => [w.address.toLowerCase(), w.user_id]))
  const key = `evm:${net.id}`
  let last = BigInt(cursor(key) ?? String(head - 5n))
  if (last >= head) last = head - 1n
  const to = head - last > 40n ? last + 40n : head
  const from = last + 1n
  const verified = verifiedTokens(net.id)

  const logs = await client.getLogs({ fromBlock: from, toBlock: to, event: transferEvent, args: { to: [...byAddr.keys()] as `0x${string}`[] } })
  for (const log of logs) {
    const userId = byAddr.get((log.args.to as string).toLowerCase())
    if (!userId || !log.transactionHash || log.blockNumber == null) continue
    const token = log.address.toLowerCase()
    const def = ASSETS.find((a) => a.network === net.id && a.contract?.toLowerCase() === token)
    recordIncoming({
      userId, network: net, tokenAddress: log.address, symbol: def?.symbol ?? null, assetKey: verified.has(token) ? (def?.key ?? null) : null, amount: log.args.value as bigint,
      from: log.args.from as string, to: log.args.to as string, hash: log.transactionHash, block: Number(log.blockNumber), confirmations: Number(head - log.blockNumber + 1n), status: 'confirmed',
    })
  }
  // Native transfers: block scan, only where the native asset is a wallet asset (not Arc, where gas is USDC).
  const nativeDef = ASSETS.find((a) => a.network === net.id && a.kind === 'native')
  if (nativeDef && net.scanNative) {
    for (let n = from; n <= to; n++) {
      const block = await client.getBlock({ blockNumber: n, includeTransactions: true })
      for (const tx of block.transactions) {
        if (!tx.to || tx.value === 0n) continue
        const userId = byAddr.get(tx.to.toLowerCase())
        if (!userId) continue
        recordIncoming({
          userId, network: net, tokenAddress: null, symbol: nativeDef.symbol, assetKey: nativeDef.key, amount: tx.value, from: tx.from, to: tx.to,
          hash: tx.hash, block: Number(n), confirmations: Number(head - n + 1n), status: 'confirmed',
        })
      }
    }
  }
  setCursor(key, to.toString())
  await trackEvm(net, head)
  state(net.id, 'live', { head, last: to, ms: now() - started, error: null })
}

/** Receipts for pending/unfinal EVM transactions (ours and incoming): status, confirmations, failures, finality. */
async function trackEvm(net: NetworkDef, head: bigint) {
  const client = evmClient(net.id)
  const open = all<{ id: string; user_id: string; tx_hash: string; type: string; status: string; block_number: number | null; confirmations: number; created_at: number; symbol: string }>(
    "SELECT * FROM wallet_txs WHERE network=? AND status IN ('pending','confirmed') AND tx_hash NOT LIKE 'pending:%' AND tx_hash NOT LIKE 'sim:%'", net.id,
  )
  for (const t of open) {
    const receipt = await client.getTransactionReceipt({ hash: t.tx_hash as Hash }).catch(() => null)
    if (!receipt) {
      if (t.type === 'sent' && now() - t.created_at > 120_000) {
        const tx = await client.getTransaction({ hash: t.tx_hash as Hash }).catch(() => null)
        if (!tx) setFailed(t, 'dropped', 'Transaction not found on the network after 2 minutes (dropped or replaced)')
      }
      continue
    }
    if (receipt.status === 'reverted') {
      setFailed(t, 'failed', 'Transaction reverted onchain')
      continue
    }
    const conf = Number(head - receipt.blockNumber + 1n)
    const fee = receipt.gasUsed * receipt.effectiveGasPrice
    const final = conf >= net.finalConfirmations
    if (t.status !== 'pending' && conf === t.confirmations) continue
    run(
      `UPDATE wallet_txs SET status=?, confirmations=?, block_number=?, fee_raw=CASE WHEN type='sent' THEN ? ELSE fee_raw END, finalized_at=CASE WHEN ? THEN COALESCE(finalized_at, ?) ELSE finalized_at END, updated_at=? WHERE id=?`,
      final ? 'finalized' : 'confirmed', conf, Number(receipt.blockNumber), fee.toString(), final ? 1 : 0, now(), now(), t.id,
    )
    if (t.status === 'pending') {
      walletDecision('monitor', `${t.type === 'sent' ? 'Outgoing' : 'Incoming'} ${t.symbol} transaction included in block ${receipt.blockNumber}`, { txId: t.id, reasons: [`${conf} confirmations`] })
      void syncUser(t.user_id)
    }
    if (final && t.status !== 'finalized') {
      walletDecision('settle', 'Transaction final', { txId: t.id, reasons: [`${conf} confirmations`] })
      if (t.type === 'sent') notify(t.user_id, 'order', 'Transfer confirmed', `Your ${t.symbol} transfer on ${net.name} is final.`)
    }
  }
}

function setFailed(t: { id: string; user_id: string; type: string; symbol: string; tx_hash: string }, status: 'failed' | 'dropped', why: string) {
  run('UPDATE wallet_txs SET status=?, note=?, updated_at=? WHERE id=?', status, why, now(), t.id)
  walletDecision('monitor', `Transaction ${status}`, { txId: t.id, score: 60, reasons: [why] })
  alert('warning', `wallet_tx_${status}`, `Wallet transaction ${status}`, `${t.symbol} ${t.type} (${t.tx_hash.slice(0, 14)}...): ${why}`, t.user_id)
  notify(t.user_id, 'security', `Transaction ${status}`, why)
  void syncUser(t.user_id)
}

/* ---------- Solana devnet ---------- */
async function scanSolana(net: NetworkDef) {
  const started = now()
  const wallets = allAddresses('solana')
  const slot = await solanaRpc<number>('getSlot', [{ commitment: 'confirmed' }])
  for (const w of wallets) {
    const key = `sol:${w.address}`
    const until = cursor(key)
    const sigs = await solanaRpc<{ signature: string; err: unknown; blockTime: number | null; confirmationStatus?: string }[]>('getSignaturesForAddress', [w.address, { limit: 10, ...(until ? { until } : {}), commitment: 'confirmed' }])
    if (!until && sigs.length > 0) {
      setCursor(key, sigs[0].signature) // first run: start from now, never replay history
      continue
    }
    for (const sig of [...sigs].reverse()) {
      if (sig.err) continue
      const tx = await solanaRpc<{ transaction: { message: { accountKeys: (string | { pubkey: string })[] } }; meta: { preBalances: number[]; postBalances: number[] } } | null>('getTransaction', [sig.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }])
      if (!tx) continue
      const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey))
      const i = keys.indexOf(w.address)
      if (i < 0) continue
      const delta = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i])
      if (delta > 0n) {
        recordIncoming({ userId: w.user_id, network: net, tokenAddress: null, symbol: 'SOL', assetKey: 'SOL@solana-devnet', amount: delta, from: keys[0], to: w.address, hash: sig.signature, block: null, confirmations: 1, status: 'confirmed' })
      }
    }
    if (sigs[0]) setCursor(key, sigs[0].signature)
  }
  state(net.id, wallets.length ? 'live' : 'idle', { head: slot, ms: now() - started, error: wallets.length ? null : 'No wallets yet' })
}

/* ---------- Bitcoin testnet ---------- */
interface BtcTx { txid: string; vin: { prevout?: { scriptpubkey_address?: string } }[]; vout: { scriptpubkey_address?: string; value: number }[]; status: { confirmed: boolean; block_height?: number } }

async function scanBitcoin(net: NetworkDef) {
  const started = now()
  const wallets = allAddresses('bitcoin')
  const tip = await btcApi<number>('/blocks/tip/height')
  for (const w of wallets) {
    const key = `btc:${w.address}`
    const first = cursor(key) === null
    const txs = await btcApi<BtcTx[]>(`/address/${w.address}/txs`)
    for (const tx of txs) {
      if (first) continue // first run: mark history as seen, only report new activity
      const received = tx.vout.filter((o) => o.scriptpubkey_address === w.address).reduce((s, o) => s + BigInt(o.value), 0n)
      const spendsOurs = tx.vin.some((i) => i.prevout?.scriptpubkey_address === w.address)
      if (received === 0n || spendsOurs) continue
      const conf = tx.status.confirmed && tx.status.block_height ? tip - tx.status.block_height + 1 : 0
      const final = conf >= net.finalConfirmations
      const dupe = get<{ id: string }>("SELECT id FROM wallet_txs WHERE network=? AND tx_hash=? AND user_id=? AND type='received'", net.id, tx.txid, w.user_id)
      if (dupe) {
        run('UPDATE wallet_txs SET status=?, confirmations=?, block_number=?, finalized_at=CASE WHEN ? THEN COALESCE(finalized_at, ?) ELSE finalized_at END, updated_at=? WHERE id=? AND status<>\'finalized\'', final ? 'finalized' : conf > 0 ? 'confirmed' : 'pending', conf, tx.status.block_height ?? null, final ? 1 : 0, now(), now(), dupe.id)
        continue
      }
      recordIncoming({
        userId: w.user_id, network: net, tokenAddress: null, symbol: 'BTC', assetKey: 'BTC@bitcoin-testnet', amount: received, from: tx.vin[0]?.prevout?.scriptpubkey_address ?? 'unknown', to: w.address,
        hash: tx.txid, block: tx.status.block_height ?? null, confirmations: conf, status: conf > 0 ? 'confirmed' : 'pending',
      })
    }
    if (first) setCursor(key, String(now()))
  }
  state(net.id, wallets.length ? 'live' : 'idle', { head: tip, ms: now() - started, error: wallets.length ? null : 'No wallets yet' })
}

/* ---------- scheduler ---------- */
function loop(net: NetworkDef, every: number, fn: (n: NetworkDef) => Promise<void>) {
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      await fn(net)
    } catch (e) {
      state(net.id, 'degraded', { error: scrub(e) })
    } finally {
      busy = false
    }
  }
  void tick()
  setInterval(() => void tick(), every)
}

export function startWalletMonitors() {
  for (const n of NETWORKS) {
    if (n.family === 'evm') loop(n, n.id === 'arc-testnet' ? 2000 : 4000, scanEvm)
    if (n.family === 'solana') loop(n, 8000, scanSolana)
    if (n.family === 'bitcoin') loop(n, 15_000, scanBitcoin)
  }
  // Periodic balance verification so displayed balances never drift from the chain.
  setInterval(() => {
    for (const w of allAddresses('evm')) void syncUser(w.user_id)
  }, 30_000)
}

export { getNetwork }
