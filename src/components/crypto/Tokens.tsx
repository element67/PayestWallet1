import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { crypto, ngn, short } from '@/lib/format'
import { useTokens, type Token, type TokenLists } from '@/lib/home'
import { usePrivacy } from '@/lib/privacy'
import { Badge, Card, TokenIcon, cx } from '../ui'

function CopyAddress({ address }: { address: string }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(address).then(() => { setDone(true); toast.success('Address copied'); setTimeout(() => setDone(false), 1500) }).catch(() => toast.error('Copy is blocked here. Select the address instead.'))
  }
  return (
    <div className="mt-2 flex min-h-[44px] items-center justify-between gap-2 rounded-2xl bg-muted px-3">
      <span className="mono truncate text-xs" title={address}>{short(address, 8, 5)}</span>
      <button onClick={copy} aria-label="Copy address" className="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-surface">
        {done ? <Check size={16} className="text-success" /> : <Copy size={16} />}
      </button>
    </div>
  )
}

function TokenRow({ t, action }: { t: Token; action?: React.ReactNode }) {
  const { mask } = usePrivacy('crypto')
  const held = t.balance !== null && Number(t.balance) > 0
  return (
    <div className="px-4 py-3">
      <div className="flex min-h-[44px] items-center gap-3">
        <TokenIcon symbol={t.symbol} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t.name}</div>
          <div className="truncate text-xs text-subtle">{t.networkName}</div>
        </div>
        {action ?? (
          <div className="shrink-0 text-right">
            <div className="num text-sm font-semibold">{mask(`${crypto(t.balance ?? '0')} ${t.symbol}`)}</div>
            <div className="num text-xs text-subtle">{t.error ? <span className="text-danger">Degraded</span> : t.valueNgn !== null ? mask(ngn(t.valueNgn)) : held ? 'No rate set' : mask(ngn('0'))}</div>
          </div>
        )}
      </div>
      {!action && t.address && <CopyAddress address={t.address} />}
    </div>
  )
}

/** "Your tokens" (added or held) and "More tokens" (supported but not added). Adding is a saved action. */
export function Tokens() {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useTokens()
  const add = useMutation({
    mutationFn: (assetKey: string) => api<TokenLists>('/api/crypto/tokens', { method: 'POST', body: { assetKey } }),
    onSuccess: (d) => {
      qc.setQueryData(['tokens'], d)
      void qc.invalidateQueries({ queryKey: ['crypto'] })
      toast.success('Token added to your wallet')
    },
    onError: (e) => toast.error(e.message),
  })
  if (isLoading) return <div className="h-48 animate-pulse rounded-3xl bg-muted" aria-busy="true" />
  if (isError || !data) return <p className="text-sm text-danger">Could not load your tokens.</p>
  return (
    <>
      <section>
        <h2 className="display mb-2 text-xl font-semibold">Your tokens</h2>
        <Card className="divide-y divide-line overflow-hidden !p-0">
          {data.mine.length === 0 && <p className="px-4 py-5 text-sm text-subtle">You have not added any tokens yet. Add one below to see its address.</p>}
          {data.mine.map((t) => <TokenRow key={t.key} t={t} />)}
        </Card>
      </section>
      <section>
        <h2 className="display mb-2 text-xl font-semibold">More tokens</h2>
        <Card className="divide-y divide-line overflow-hidden !p-0">
          {data.more.map((t) => (
            <TokenRow
              key={t.key}
              t={t}
              action={
                <button
                  onClick={() => add.mutate(t.key)}
                  disabled={add.isPending}
                  aria-label={`Add ${t.symbol} on ${t.networkName}`}
                  className={cx('flex min-h-[44px] shrink-0 items-center gap-1 rounded-2xl border border-line-strong px-4 text-sm font-semibold hover:bg-muted active:scale-95', add.isPending && add.variables === t.key && 'hatch')}
                >
                  <Plus size={15} /> Add
                </button>
              }
            />
          ))}
          {data.unavailable.map((u) => (
            <div key={u.symbol} className="flex min-h-[64px] items-center gap-3 px-4 py-3">
              <TokenIcon symbol={u.symbol} size={36} />
              <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{u.name}</div><div className="text-xs text-subtle">No verified testnet contract</div></div>
              <Badge kind="warn">Not available</Badge>
            </div>
          ))}
        </Card>
        <p className="mt-2 text-xs text-subtle">Adding a token never creates a balance. Balances come from the blockchain.</p>
      </section>
    </>
  )
}
