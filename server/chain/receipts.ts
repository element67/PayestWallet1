/**
 * Helpers for reading transaction receipts safely. A network error, a rate limit or an expired proxy token is NOT
 * the same thing as "this transaction does not exist": only a genuine not-found answer may ever count towards
 * calling a transaction dropped, and even then only after several misses while the chain keeps moving.
 */
import { TransactionNotFoundError, TransactionReceiptNotFoundError } from 'viem'

export type Lookup<T> = { kind: 'found'; value: T } | { kind: 'missing' } | { kind: 'error'; error: unknown }

/** True for the node's "no such transaction/receipt" answer, including when it is wrapped as a cause. */
export function isNotFoundError(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth++) {
    if (cur instanceof TransactionReceiptNotFoundError || cur instanceof TransactionNotFoundError) return true
    const name = (cur as { name?: string }).name
    if (name === 'TransactionReceiptNotFoundError' || name === 'TransactionNotFoundError') return true
    cur = (cur as { cause?: unknown }).cause
  }
  return false
}

/** Runs a lookup and classifies the outcome. A null/undefined result and a not-found error both mean "missing". */
export async function lookup<T>(fn: () => Promise<T | null | undefined>): Promise<Lookup<T>> {
  try {
    const v = await fn()
    return v === null || v === undefined ? { kind: 'missing' } : { kind: 'found', value: v }
  } catch (e) {
    return isNotFoundError(e) ? { kind: 'missing' } : { kind: 'error', error: e }
  }
}

/** Consecutive genuine misses, counted only while the head advances, before a confirmed transaction is called dropped. */
export const MISS_LIMIT = 5

/**
 * Decides what a "receipt missing" answer means. A miss only counts when the chain head moved since the last counted
 * miss, so one slow node, or many polls within the same block, never add up to a drop.
 */
export function registerMiss(state: { misses: number; lastHead: bigint | null }, head: bigint): { misses: number; lastHead: bigint; drop: boolean } {
  if (state.lastHead !== null && head <= state.lastHead) return { misses: state.misses, lastHead: state.lastHead, drop: false }
  const misses = state.misses + 1
  return { misses, lastHead: head, drop: misses >= MISS_LIMIT }
}

/**
 * Confirmations of a transaction in `blockNumber` when the head is `head`. Load-balanced nodes can disagree by a block,
 * so the head may briefly be behind the receipt: a mined transaction always has at least one confirmation.
 */
export function confirmationsFor(head: bigint, blockNumber: bigint): number {
  const n = head - blockNumber + 1n
  return Number(n < 1n ? 1n : n)
}
