import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { parseError, short } from '@/lib/format'
import type { RegNetworkInfo, TokenInfo } from '@/lib/tokens'
import { Badge, Button, Card, Field, TokenIcon, cx } from '../ui'

type AdminToken = Omit<TokenInfo, 'networks'> & { active: boolean; networks: TokenInfo['networks'] }

/** Founder-only token registry. The server enforces the role and every rule; this screen only calls it. */
export function TokensAdmin() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['a-tokens'], queryFn: () => api<{ tokens: AdminToken[]; networks: RegNetworkInfo[] }>('/api/admin/tokens') })
  const [open, setOpen] = useState<string | null>(null)
  const done = (msg: string) => { toast.success(msg); void qc.invalidateQueries({ queryKey: ['a-tokens'] }); void qc.invalidateQueries({ queryKey: ['tokens-registry'] }); void qc.invalidateQueries({ queryKey: ['crypto'] }) }
  const call = useMutation({
    mutationFn: (r: { path: string; method: string; body: unknown; ok: string }) => api(r.path, { method: r.method, body: r.body }).then(() => r.ok),
    onSuccess: done, onError: (e) => toast.error(parseError(e)),
  })
  const [add, setAdd] = useState({ symbol: '', name: '', decimals: '18' })
  const [dep, setDep] = useState({ symbol: '', networkId: '', contract: '' })
  if (!data) return <div className="h-64 animate-pulse rounded-3xl bg-muted" aria-busy="true" />
  const net = (id: string) => data.networks.find((n) => n.id === id)?.name ?? id

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="display text-xl font-semibold">Token registry</h2>
        <p className="mt-1 text-sm text-subtle">Every token the app shows comes from here. Contracts are checked on-chain before they can be enabled. Mainnet entries are reference data and cannot be enabled in sandbox mode. Every change is audited.</p>
      </Card>
      <Card className="divide-y divide-line overflow-hidden !p-0">
        {data.tokens.map((t) => (
          <div key={t.symbol}>
            <div className="flex min-h-[64px] items-center gap-3 px-4 py-2">
              <button onClick={() => setOpen(open === t.symbol ? null : t.symbol)} aria-expanded={open === t.symbol} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <TokenIcon symbol={t.symbol} logo={t.logo} size={32} />
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{t.symbol} <span className="font-normal text-subtle">{t.name}</span></span>
                  <span className="block text-xs text-subtle">{t.networks.filter((n) => n.active).length} active of {t.networks.length} networks{t.popular ? ' · Popular' : ''}{t.tradable ? ' · Tradable' : ''}</span></span>
                <ChevronDown size={16} className={cx('text-subtle transition', open === t.symbol && 'rotate-180')} />
              </button>
              <Button variant="ghost" className="!min-h-11 !px-3 text-xs" loading={call.isPending && call.variables?.path === `/api/admin/tokens/${t.symbol}` && call.variables.method === 'PATCH'}
                onClick={() => call.mutate({ path: `/api/admin/tokens/${t.symbol}`, method: 'PATCH', body: { active: !t.active }, ok: `${t.symbol} ${t.active ? 'disabled' : 'enabled'}` })}>{t.active ? 'Disable' : 'Enable'}</Button>
            </div>
            {open === t.symbol && (
              <div className="space-y-2 bg-muted/40 px-4 py-3">
                <button className="min-h-11 text-xs font-semibold underline" onClick={() => call.mutate({ path: `/api/admin/tokens/${t.symbol}`, method: 'PATCH', body: { popular: !t.popular }, ok: t.popular ? 'Removed from Popular' : 'Added to Popular' })}>{t.popular ? 'Remove from Popular' : 'Show in Popular'}</button>
                {t.networks.map((n) => (
                  <div key={n.networkId} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-bg px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 font-semibold">{net(n.networkId)} <Badge kind={n.testnet ? 'live' : 'warn'}>{n.testnet ? 'testnet' : 'mainnet'}</Badge><Badge kind={n.verified ? 'good' : 'bad'}>{n.verified ? 'verified' : 'unverified'}</Badge></div>
                      <div className="mono mt-0.5 text-subtle">{n.contract ? short(n.contract, 10, 8) : 'Native asset'} · chain {n.chainId ?? '-'}</div>
                      {n.note && <div className="mt-0.5 text-subtle">{n.note}</div>}
                    </div>
                    <Button variant="ghost" className="!min-h-11 !px-3 text-xs" disabled={!n.active && (!n.verified || !n.testnet)}
                      onClick={() => call.mutate({ path: `/api/admin/tokens/${t.symbol}/networks/${n.networkId}`, method: 'PATCH', body: { active: !n.active }, ok: `${t.symbol} on ${net(n.networkId)} ${n.active ? 'disabled' : 'enabled'}` })}>{n.active ? 'Disable' : 'Enable'}</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </Card>
      <Card className="space-y-3 p-5">
        <h3 className="display text-lg font-semibold">Add a token</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Symbol" value={add.symbol} maxLength={10} onChange={(e) => setAdd({ ...add, symbol: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} />
          <Field label="Name" value={add.name} maxLength={40} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <Field label="Decimals" inputMode="numeric" value={add.decimals} onChange={(e) => setAdd({ ...add, decimals: e.target.value.replace(/\D/g, '') })} />
        </div>
        <Button disabled={add.symbol.length < 2 || add.name.length < 2 || add.decimals === ''} loading={call.isPending && call.variables?.path === '/api/admin/tokens' && call.variables.method === 'POST'}
          onClick={() => call.mutate({ path: '/api/admin/tokens', method: 'POST', body: { symbol: add.symbol, name: add.name, decimals: Number(add.decimals) }, ok: `${add.symbol} added` })}>Add token</Button>
      </Card>
      <Card className="space-y-3 p-5">
        <h3 className="display text-lg font-semibold">Add a network</h3>
        <p className="text-xs text-subtle">The address must be the exact checksummed contract address. The server checks that the contract exists on that chain with the same symbol and decimals before saving. Leave it empty for a chain's native asset.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm"><span className="eyebrow mb-1 block">Token</span>
            <select value={dep.symbol} onChange={(e) => setDep({ ...dep, symbol: e.target.value })} className="min-h-[44px] w-full rounded-2xl border border-line bg-bg px-3 text-sm"><option value="">Choose</option>{data.tokens.map((t) => <option key={t.symbol}>{t.symbol}</option>)}</select></label>
          <label className="block text-sm"><span className="eyebrow mb-1 block">Network</span>
            <select value={dep.networkId} onChange={(e) => setDep({ ...dep, networkId: e.target.value })} className="min-h-[44px] w-full rounded-2xl border border-line bg-bg px-3 text-sm"><option value="">Choose</option>{data.networks.map((n) => <option key={n.id} value={n.id}>{n.name}{n.testnet ? '' : ' (mainnet)'}</option>)}</select></label>
        </div>
        <Field label="Contract address" className="mono !text-xs" value={dep.contract} maxLength={42} onChange={(e) => setDep({ ...dep, contract: e.target.value.trim() })} placeholder="0x..." />
        <Button disabled={!dep.symbol || !dep.networkId} loading={call.isPending && call.variables?.path.endsWith('/networks') === true}
          onClick={() => call.mutate({ path: `/api/admin/tokens/${dep.symbol}/networks`, method: 'POST', body: { networkId: dep.networkId, contract: dep.contract || null }, ok: 'Network added. Enable it once you are happy with the check.' })}>Verify and add</Button>
      </Card>
    </div>
  )
}
