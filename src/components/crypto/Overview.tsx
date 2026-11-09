import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, FlaskConical, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { CryptoOverview } from '@/lib/crypto'
import { ago, ngn, short, usd } from '@/lib/format'
import { useBalanceSummary } from '@/lib/home'
import { EyeToggle, usePrivacy } from '@/lib/privacy'
import { useSession } from '@/lib/session'
import { ActionButton, HOME_ACTIONS } from '../home/Actions'
import { Badge, Button, Card, Empty, Sandbox, cx } from '../ui'
import { EmptyBalance } from './EmptyBalance'
import { Tokens } from './Tokens'

export type CryptoAction = 'send' | 'receive' | 'exchange' | 'buy' | 'sell' | 'swap' | 'bridge' | 'history'
const CRYPTO_ACTIONS = ['send', 'receive', 'exchange', 'buy', 'sell', 'swap', 'bridge'] as const

export function Overview({ data, go }: { data: CryptoOverview; go: (a: CryptoAction) => void }) {
  const qc = useQueryClient()
  const { user } = useSession()
  const { mask } = usePrivacy('crypto')
  const { data: sum, isError: sumError, refetch: retrySum } = useBalanceSummary()
  const [dev, setDev] = useState(false)
  const refresh = useMutation({
    mutationFn: () => api<CryptoOverview>('/api/crypto/refresh', { method: 'POST' }),
    onSuccess: (d) => {
      qc.setQueryData(['crypto'], d)
      void qc.invalidateQueries({ queryKey: ['home'] })
      void qc.invalidateQueries({ queryKey: ['tokens'] })
    },
    onError: (e) => toast.error(e.message),
  })
  const simulate = useMutation({
    mutationFn: (kind: string) => api('/api/crypto/sandbox/simulate', { method: 'POST', body: { kind } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crypto'] })
      void qc.invalidateQueries({ queryKey: ['crypto-txs'] })
      toast.success('Simulated event recorded and labelled')
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-6">
      <Card strong className="p-5">
        <div className="flex items-center justify-between gap-2">
          <Badge kind="live">Testnet, onchain</Badge>
          <button aria-label="Refresh balances" onClick={() => refresh.mutate()} className="grid size-11 place-items-center rounded-xl border border-line hover:bg-muted">
            <RefreshCw size={16} className={cx(refresh.isPending && 'animate-spin')} />
          </button>
        </div>
        <div className="eyebrow mt-3">Total crypto value</div>
        <div className="flex items-center justify-between gap-3">
          <div className="display num min-w-0 truncate text-4xl font-semibold">{sum ? mask(sum.preference.cryptoCurrency === 'USD' ? usd(sum.crypto.usd) : ngn(sum.crypto.ngn)) : sumError ? '—' : '…'}</div>
          <EyeToggle scope="crypto" />
        </div>
        <p className="mt-1 text-xs text-subtle">
          At your configured rates; testnet assets have no market value.
          {sum?.crypto.includesSandbox && ' Includes sandbox exchange balances.'}
          {sumError && <button onClick={() => void retrySum()} className="ml-1 font-semibold text-danger underline">Couldn't load balance, tap to retry</button>}
          {data.unpricedSymbols.length > 0 && ` No rate for ${data.unpricedSymbols.join(', ')}.`}
          {data.syncing ? ' Verifying balances…' : data.syncedAt ? ` Verified ${ago(data.syncedAt)}.` : ''}
        </p>
      </Card>

      {sum && Number(sum.crypto.ngn) === 0 && <EmptyBalance address={data.addresses.evm} onDeposit={() => go('receive')} />}

      <div className="grid grid-cols-4 gap-y-4">
        {CRYPTO_ACTIONS.map((id) => {
          const a = HOME_ACTIONS.find((x) => x.id === id)
          if (!a) return null
          return <ActionButton key={id} label={a.label} icon={a.icon} primary={'primary' in a && a.primary} onClick={() => go(id)} />
        })}
      </div>

      <Tokens />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-xl font-semibold">Recent activity</h2>
          <button onClick={() => go('history')} className="min-h-[44px] px-1 text-sm font-semibold underline">View all</button>
        </div>
        <Card className="p-2">
          {!data.recentTxs.length && <Empty title="No activity yet" />}
          {data.recentTxs.map((t) => (
            <div key={t.id} className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold capitalize">{t.type} {t.symbol ?? 'unknown token'}</div>
                <div className="mono truncate text-xs text-subtle">{t.simulated ? 'simulated' : short(t.hash, 10, 6)} · {ago(t.createdAt)}</div>
              </div>
              <Badge kind={t.verdict === 'unverified_token' ? 'bad' : t.status === 'finalized' ? 'good' : t.status === 'failed' || t.status === 'dropped' ? 'bad' : 'warn'}>{t.verdict === 'unverified_token' ? 'unverified' : t.status}</Badge>
            </div>
          ))}
        </Card>
      </section>

      {user?.devPreview && (
        <section>
          <button onClick={() => setDev(!dev)} aria-expanded={dev} className="flex min-h-[44px] w-full items-center justify-between rounded-2xl border border-line px-4 text-sm font-semibold hover:bg-muted">
            <span className="flex items-center gap-2"><FlaskConical size={16} /> Developer tools <Sandbox /></span>
            <ChevronDown size={16} className={cx('transition', dev && 'rotate-180')} />
          </button>
          {dev && (
            <Card className="mt-3 p-4">
              <p className="text-xs text-subtle">Records labelled test events so you can see alerts and the AI monitor react. They never touch balances or any chain.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Button variant="ghost" loading={simulate.isPending && simulate.variables === 'unverified_token'} onClick={() => simulate.mutate('unverified_token')}>Simulate unverified token</Button>
                <Button variant="ghost" loading={simulate.isPending && simulate.variables === 'failed_send'} onClick={() => simulate.mutate('failed_send')}>Simulate failed transfer</Button>
              </div>
            </Card>
          )}
        </section>
      )}
    </div>
  )
}
