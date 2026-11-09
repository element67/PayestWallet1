/** One-time clean-ups that run at startup. Each is idempotent and recorded in the audit log. */
import { all, audit, run, setting } from './db'
import { SYS, balancesFor, move } from './ledger'

/**
 * Early builds gave preview accounts a 100 USDC "starter balance" and test runs added more sandbox crypto on top.
 * This removes those exchange balances with compensating ledger entries (the ledger is never edited), once.
 */
export function removeStarterBalances() {
  if (setting('cleanup_starter_v1') === 'done') return
  const seeded = all<{ owner: string }>("SELECT DISTINCT owner FROM ledger_entries WHERE reason='sandbox starter balance'")
  let removed = 0
  for (const { owner } of seeded) {
    for (const [asset, amount] of Object.entries(balancesFor(owner))) {
      if (asset === 'NGN' || amount <= 0n) continue
      if (move({ from: owner, to: SYS.mint, asset, amount, reason: 'sandbox starter balance removed', idem: `cleanup-starter:${owner}:${asset}` })) removed++
    }
  }
  run("INSERT OR REPLACE INTO settings(key, value) VALUES ('cleanup_starter_v1', 'done')")
  audit(null, 'system.cleanup_starter_balances', 'ledger', undefined, { accounts: seeded.length, entriesReversed: removed })
}
