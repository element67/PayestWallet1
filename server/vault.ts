/**
 * Vault boundary. The agent never touches keys. This build has only a SANDBOX vault signer:
 * releases update ledgers and record clearly-simulated outbound transfers. A real custody signer
 * (for example Circle developer-controlled wallets) plugs in here behind the same interface.
 */
import { isAddress } from 'viem'
import { get, now, run, setting, uid } from './db'
import { post } from './ledger'
import { randomHex } from './security'
import type { OrderRow } from './orders'

export const vaultAddressArc = () => {
  const v = setting('vault_address_arc').trim()
  return isAddress(v) ? v.toLowerCase() : null
}

export function validDestination(symbol: string, addr: string): boolean {
  if (symbol === 'USDC' || symbol === 'USDT') return isAddress(addr)
  if (symbol === 'SOL') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)
  if (symbol === 'BTC') return /^(bc1|tb1)[a-z0-9]{25,62}$|^[13mn2][a-km-zA-HJ-NP-Z1-9]{25,40}$/.test(addr)
  return false
}

export const vaultSigner = { name: 'sandbox-vault-signer', simulated: true } as const

/** Releases crypto for a buy order. Idempotent per order. Returns the simulated tx hash for external sends. */
export function releaseCrypto(order: OrderRow): string | null {
  const amount = BigInt(order.crypto_amount)
  post({ owner: 'house', asset: order.asset, delta: -amount, reason: 'vault release', idem: `release:${order.id}:house`, orderId: order.id })
  if (!order.dest_address) {
    post({ owner: order.user_id, asset: order.asset, delta: amount, reason: 'purchase credited to platform wallet', idem: `release:${order.id}:user`, orderId: order.id })
    return null
  }
  const existing = get<{ tx_hash: string }>("SELECT tx_hash FROM chain_txs WHERE order_id=? AND status='finalized' AND simulated=1 AND from_addr='vault'", order.id)
  if (existing) return existing.tx_hash
  const hash = `sim:0x${randomHex(32)}`
  run(
    `INSERT INTO chain_txs(id, chain, tx_hash, log_index, token_address, asset, from_addr, to_addr, amount, confirmations, status, verdict, order_id, simulated, first_seen_at, updated_at, settled_at)
     VALUES (?,?,?,0,NULL,?,?,?,?,1,'finalized','genuine',?,1,?,?,?)`,
    uid('ctx'), 'sandbox', hash, order.asset, 'vault', order.dest_address, amount.toString(), order.id, now(), now(), now(),
  )
  return hash
}
