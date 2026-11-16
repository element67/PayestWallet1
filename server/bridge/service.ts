/**
 * Real cross-chain USDC transfers over Circle's CCTP (App Kit), signed by the user's app wallet after a transaction PIN.
 *
 * Safety rules enforced here:
 * - USDC only, between three fixed testnets, and always to the user's OWN address (no free recipient field).
 * - Same founder per-transaction limit as wallet sends; a token with no limit set cannot be bridged.
 * - The amount, chains and recipient are bound by a signed, short-lived confirmation; the PIN is checked on every start and retry.
 * - The destination mint is done by Circle's Forwarding Service, so the wallet never needs gas on the destination chain.
 * - The wallet key exists in memory only inside the signing callback. A failed transfer is resumed with retry, never re-run from scratch.
 */
import { createHmac } from 'node:crypto'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { bytesToHex } from 'viem'
import { CONFIG } from '../config'
import { HttpError, type User } from '../auth'
import { all, alert, audit, get, notify, now, run, setting, uid } from '../db'
import { fromUnits, toUnits } from '../money'
import { verifyPin, assertOperational } from '../naira/wallet'
import { scrub } from '../rpc'
import { readBalance } from '../wallet/chains'
import { ensureWallet, withEvmAccount } from '../wallet/keys'
import { getAssetDef, getNetwork } from '../wallet/networks'
import { walletLimits } from '../wallet/service'

export const BRIDGE_CHAINS = { 'arc-testnet': 'Arc_Testnet', 'ethereum-sepolia': 'Ethereum_Sepolia', 'base-sepolia': 'Base_Sepolia' } as const
export type BridgeChainId = keyof typeof BRIDGE_CHAINS
export const WARN_ABOVE_USDC = 100

export interface BridgeInput { from: BridgeChainId; to: BridgeChainId; amount: string }

const asChain = (v: unknown): BridgeChainId => {
  if (typeof v !== 'string' || !(v in BRIDGE_CHAINS)) throw new HttpError(400, 'Choose Arc Testnet, Ethereum Sepolia or Base Sepolia')
  return v as BridgeChainId
}

export function checkInput(i: BridgeInput): { from: BridgeChainId; to: BridgeChainId; amountRaw: bigint } {
  const from = asChain(i.from), to = asChain(i.to)
  if (from === to) throw new HttpError(400, 'Choose two different networks')
  if (!/^\d+(\.\d{1,6})?$/.test(i.amount)) throw new HttpError(400, 'Enter a valid USDC amount (up to 6 decimals)')
  const amountRaw = toUnits(i.amount, 6)
  if (amountRaw <= 0n) throw new HttpError(400, 'Enter an amount above zero')
  return { from, to, amountRaw }
}

const sig = (userId: string, i: BridgeInput, exp: number) =>
  createHmac('sha256', CONFIG.walletMasterKey).update(JSON.stringify(['bridge', userId, i.from, i.to, i.amount, exp])).digest('base64url')

async function evaluate(user: User, input: BridgeInput) {
  const { from, to, amountRaw } = checkInput(input)
  if (await setting('platform_paused') === 'true') throw new HttpError(503, 'Transfers are temporarily paused')
  const def = getAssetDef(`USDC@${from}`)
  if (!def) throw new HttpError(400, `USDC is not available on ${getNetwork(from)?.name ?? from}`)
  const limits = await walletLimits()
  if (!limits.perTx.USDC) throw new HttpError(403, 'Bridging USDC is not switched on yet: no send limit has been set for it.')
  if (amountRaw > toUnits(limits.perTx.USDC, 6)) throw new HttpError(403, `Per-transfer limit is ${limits.perTx.USDC} USDC`)
  const addrs = await ensureWallet(user.id)
  const address = addrs.evm
  const bal = await readBalance(def, address)
  if (bal.raw < amountRaw) throw new HttpError(400, `Not enough USDC on ${getNetwork(from)?.name}. You have ${fromUnits(bal.raw, 6)}.`)
  return { from, to, amountRaw, address, balance: bal.raw }
}

export async function previewBridge(user: User, input: BridgeInput) {
  const e = await evaluate(user, input)
  const exp = now() + 120_000
  const warnings: string[] = []
  if (Number(input.amount) > WARN_ABOVE_USDC) warnings.push(`This is more than ${WARN_ABOVE_USDC} USDC. Double-check the networks.`)
  if (e.from !== 'arc-testnet') warnings.push(`You need a little ${getNetwork(e.from)?.nativeSymbol} on ${getNetwork(e.from)?.name} to pay the network fee.`)
  warnings.push('Circle charges a small forwarding fee that is taken from the amount you receive. Standard transfers are fast, usually under a minute.')
  return {
    confirmToken: sig(user.id, input, exp), expiresAt: exp, from: e.from, to: e.to, fromName: getNetwork(e.from)?.name, toName: getNetwork(e.to)?.name,
    amount: fromUnits(e.amountRaw, 6), recipient: e.address, balance: fromUnits(e.balance, 6), warnings,
  }
}

interface StepView { name: string; state: string; txHash?: string; explorerUrl?: string; error?: string }
const viewSteps = (steps: unknown): StepView[] =>
  (Array.isArray(steps) ? steps : []).map((s: Record<string, unknown>) => ({
    name: String(s.name), state: String(s.state), txHash: typeof s.txHash === 'string' ? s.txHash : undefined,
    explorerUrl: typeof s.explorerUrl === 'string' ? s.explorerUrl : undefined,
    error: s.error ? scrub(s.error) : undefined,
  }))

const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)

export function opView(r: Record<string, unknown>) {
  return {
    id: r.id, from: r.from_chain, to: r.to_chain, fromName: getNetwork(String(r.from_chain))?.name, toName: getNetwork(String(r.to_chain))?.name,
    amount: r.amount, recipient: r.recipient, status: r.status, steps: JSON.parse(String(r.steps)) as StepView[], error: r.error ?? null,
    canRetry: r.status === 'failed' && Boolean(r.result), createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

const running = new Set<string>()

/** Runs (or resumes) the transfer in the background. Progress lands in the database; the screen polls it. */
async function drive(opId: string, userId: string, input: BridgeInput, resume: unknown | null) {
  if (running.has(opId)) return
  running.add(opId)
  // A heartbeat shows the transfer is alive. If this process stops, the heartbeat stops and the sweep below marks it interrupted.
  const beat = setInterval(() => void run("UPDATE bridge_ops SET updated_at=? WHERE id=? AND status='running'", now(), opId), 15_000)
  try {
    await withEvmAccount(userId, async (account) => {
      const privateKey = bytesToHex(account.getHdKey().privateKey as Uint8Array)
      const adapter = createViemAdapterFromPrivateKey({ privateKey })
      const kit = new AppKit()
      // Live progress: every step event updates the stored step list so the screen can show where the transfer is.
      const live = new Map<string, StepView>()
      kit.on('*', (payload: unknown) => {
        const p = payload as { method?: string; values?: Record<string, unknown> }
        if (!p.method?.startsWith('bridge.')) return
        const name = p.method.slice('bridge.'.length)
        const v = p.values ?? {}
        const txHash = typeof v.txHash === 'string' ? v.txHash : typeof v.transactionHash === 'string' ? v.transactionHash : undefined
        live.set(name, { name, state: String(v.state ?? 'success'), txHash, explorerUrl: typeof v.explorerUrl === 'string' ? v.explorerUrl : undefined })
        void run('UPDATE bridge_ops SET steps=?, updated_at=? WHERE id=?', JSON.stringify([...live.values()]), now(), opId)
      })
      const recipient = account.address
      const result = resume
        ? await kit.retryBridge(resume as Parameters<typeof kit.retryBridge>[0], { from: adapter, to: adapter })
        : await kit.bridge({
            from: { adapter, chain: BRIDGE_CHAINS[input.from] },
            to: { recipientAddress: recipient, chain: BRIDGE_CHAINS[input.to], useForwarder: true },
            amount: input.amount,
          })
      const steps = viewSteps(result.steps)
      const ok = result.state === 'success'
      const failedStep = steps.find((s) => s.state === 'error')
      await run('UPDATE bridge_ops SET status=?, steps=?, error=?, result=?, updated_at=? WHERE id=?',
        ok ? 'completed' : 'failed', JSON.stringify(steps), ok ? null : (failedStep?.error ?? 'The transfer did not finish'), ok ? null : JSON.stringify(result, replacer), now(), opId)
      if (ok) await notify(userId, 'order', 'Bridge complete', `${input.amount} USDC arrived on ${getNetwork(input.to)?.name}.`)
      else await alert('warning', 'bridge_failed', 'Bridge transfer stopped', failedStep?.error ?? 'Unknown', userId)
      await audit(userId, ok ? 'bridge.completed' : 'bridge.failed', opId, undefined, { from: input.from, to: input.to, amount: input.amount })
    })
  } catch (e) {
    await run("UPDATE bridge_ops SET status='failed', error=?, updated_at=? WHERE id=?", scrub(e), now(), opId)
    await alert('warning', 'bridge_failed', 'Bridge transfer failed to start', scrub(e), userId)
  } finally {
    clearInterval(beat)
    running.delete(opId)
  }
}

export async function startBridge(user: User, input: BridgeInput, confirmToken: string, expiresAt: number, pin: string, idem: string) {
  const dupe = await get<Record<string, unknown>>('SELECT * FROM bridge_ops WHERE user_id=? AND idem_key=?', user.id, idem)
  if (dupe) return opView(dupe)
  if (expiresAt < now()) throw new HttpError(410, 'This confirmation expired. Review the details again.')
  if (sig(user.id, input, expiresAt) !== confirmToken) throw new HttpError(400, 'The details changed after confirmation. Review them again.')
  await assertOperational(user.id)
  await verifyPin(user.id, pin)
  const e = await evaluate(user, input)
  const id = uid('brg')
  try {
    await run(
      "INSERT INTO bridge_ops(id,user_id,from_chain,to_chain,amount,recipient,status,idem_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id, user.id, e.from, e.to, input.amount, e.address, 'running', idem, now(), now(),
    )
  } catch {
    const again = await get<Record<string, unknown>>('SELECT * FROM bridge_ops WHERE user_id=? AND idem_key=?', user.id, idem)
    if (again) return opView(again)
    throw new HttpError(409, 'Could not record this transfer')
  }
  await audit(user.id, 'bridge.started', id, undefined, { from: e.from, to: e.to, amount: input.amount, recipient: e.address })
  void drive(id, user.id, input, null)
  return opView(await get<Record<string, unknown>>('SELECT * FROM bridge_ops WHERE id=?', id) as Record<string, unknown>)
}

export async function retryBridge(user: User, opId: string, pin: string) {
  const row = await get<Record<string, unknown>>('SELECT * FROM bridge_ops WHERE id=? AND user_id=?', opId, user.id)
  if (!row) throw new HttpError(404, 'Transfer not found')
  if (row.status !== 'failed' || !row.result) throw new HttpError(409, 'This transfer cannot be resumed')
  await assertOperational(user.id)
  await verifyPin(user.id, pin)
  await run("UPDATE bridge_ops SET status='running', error=NULL, updated_at=? WHERE id=?", now(), opId)
  void drive(opId, user.id, { from: row.from_chain as BridgeChainId, to: row.to_chain as BridgeChainId, amount: String(row.amount) }, JSON.parse(String(row.result)))
  return opView(await get<Record<string, unknown>>('SELECT * FROM bridge_ops WHERE id=?', opId) as Record<string, unknown>)
}

export async function getBridgeOp(user: User, opId: string) {
  const row = await get<Record<string, unknown>>('SELECT * FROM bridge_ops WHERE id=? AND user_id=?', opId, user.id)
  if (!row) throw new HttpError(404, 'Transfer not found')
  return opView(row)
}

export const listBridgeOps = async (user: User) =>
  (await all<Record<string, unknown>>('SELECT * FROM bridge_ops WHERE user_id=? ORDER BY created_at DESC LIMIT 30', user.id)).map(opView)

/** A transfer whose heartbeat stopped (its process was restarted) is marked failed so the person is told instead of waiting forever. Run by the worker. */
export async function sweepStaleBridgeOps() {
  await run("UPDATE bridge_ops SET status='failed', error='The server restarted during this transfer. If the burn step shows a transaction hash, contact support so it can be completed.', updated_at=? WHERE status='running' AND updated_at<?", now(), now() - 180_000)
}
