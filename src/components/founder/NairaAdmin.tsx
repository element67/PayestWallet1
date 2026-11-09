import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ago, ngn, parseError } from '@/lib/format'
import { TXN_STATUS, newKey } from '@/lib/naira'
import { Badge, Button, Card, Empty, Field, Row, Segmented, cx } from '../ui'
import { Sheet } from '../naira/Sheet'

type Panel = 'users' | 'transactions' | 'p2p' | 'bills' | 'settings' | 'security'

interface AUser { id: string; email: string; name: string; username: string | null; accountStatus: string; balance: string; spent24h: string; lastLoginAt: number | null; wallet: { status: string; accountNumber: string; pinSet: boolean; pinLocked: boolean; freezeReason: string | null } | null }
interface ATxn { id: string; reference: string; type: string; direction: string; amount: string; fee: string; status: string; title: string; email: string; userId: string; createdAt: number; failureReason: string | null; reversed: boolean }

export function NairaAdmin() {
  const [panel, setPanel] = useState<Panel>('users')
  return (
    <div className="space-y-4">
      <div className="scroll-thin overflow-x-auto pb-1">
        <Segmented value={panel} onChange={setPanel} options={[
          { value: 'users', label: 'Wallets' }, { value: 'transactions', label: 'Transactions' }, { value: 'p2p', label: 'P2P deposits' },
          { value: 'bills', label: 'Bill orders' }, { value: 'settings', label: 'Fees and limits' }, { value: 'security', label: 'Security' },
        ]} />
      </div>
      {panel === 'users' && <Users />}
      {panel === 'transactions' && <Transactions />}
      {panel === 'p2p' && <P2p />}
      {panel === 'bills' && <Bills />}
      {panel === 'settings' && <Settings />}
      {panel === 'security' && <Security />}
    </div>
  )
}

function Users() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['a-naira-users'], queryFn: () => api<{ users: AUser[] }>('/api/admin/naira/users').then((r) => r.users), refetchInterval: 5000 })
  const [open, setOpen] = useState<AUser | null>(null)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const ledger = useQuery({
    queryKey: ['a-naira-ledger', open?.id], enabled: Boolean(open),
    queryFn: () => api<{ entries: { id: number; txnId: string; side: string; amount: string; balanceAfter: string; reason: string; at: number }[] }>(`/api/admin/naira/users/${open!.id}/ledger`).then((r) => r.entries),
  })
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['a-naira-users'] }); void qc.invalidateQueries({ queryKey: ['a-naira-ledger'] }) }
  const freeze = useMutation({
    mutationFn: (v: { id: string; frozen: boolean }) => api(`/api/admin/naira/users/${v.id}/freeze`, { method: 'POST', body: { frozen: v.frozen, reason: v.frozen ? reason : undefined } }),
    onSuccess: () => { toast.success('Updated'); setReason(''); refresh() }, onError: (e) => toast.error(parseError(e)),
  })
  const unlock = useMutation({ mutationFn: (id: string) => api(`/api/admin/naira/users/${id}/unlock-pin`, { method: 'POST' }), onSuccess: () => { toast.success('PIN unlocked'); refresh() } })
  const adjust = useMutation({
    mutationFn: (d: 'credit' | 'debit') => api(`/api/admin/naira/users/${open!.id}/adjust`, { method: 'POST', body: { direction: d, amount, note: reason, idempotencyKey: newKey() } }),
    onSuccess: () => { toast.success('Adjustment recorded in the ledger'); setAmount(''); setReason(''); refresh() }, onError: (e) => toast.error(parseError(e)),
  })

  return (
    <>
      <Card className="overflow-hidden p-2">
        {!data && <div className="h-40 animate-pulse rounded-2xl bg-muted" />}
        {data?.length === 0 && <Empty title="No users yet" />}
        {(data ?? []).map((u) => (
          <button key={u.id} onClick={() => setOpen(u)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted">
            <div className="min-w-0"><div className="truncate text-sm font-semibold">{u.name} <span className="text-xs text-subtle">{u.username ? `@${u.username}` : ''}</span></div><div className="truncate text-xs text-subtle">{u.email}</div></div>
            <div className="flex shrink-0 items-center gap-2">
              {u.wallet?.status === 'frozen' && <Badge kind="bad">Frozen</Badge>}
              {u.wallet?.pinLocked && <Badge kind="warn">PIN locked</Badge>}
              <span className="num text-sm font-semibold">{ngn(u.balance)}</span>
            </div>
          </button>
        ))}
      </Card>
      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open?.name ?? ''}>
        {open && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-muted p-4">
              <Row label="Email" value={open.email} /><Row label="Naira balance" value={ngn(open.balance)} /><Row label="Spent in 24h" value={ngn(open.spent24h)} />
              <Row label="Virtual account" value={open.wallet?.accountNumber ?? 'none yet'} mono /><Row label="PIN" value={open.wallet?.pinSet ? (open.wallet.pinLocked ? 'Locked' : 'Set') : 'Not set'} />
              <Row label="Last sign-in" value={open.lastLoginAt ? ago(open.lastLoginAt) : 'never'} />
            </div>
            <Field label="Reason (required for freezes and adjustments)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              {open.wallet?.status === 'frozen'
                ? <Button variant="soft" loading={freeze.isPending} onClick={() => freeze.mutate({ id: open.id, frozen: false })}>Unfreeze</Button>
                : <Button variant="danger" disabled={reason.trim().length < 5} loading={freeze.isPending} onClick={() => freeze.mutate({ id: open.id, frozen: true })}>Freeze account</Button>}
              <Button variant="soft" disabled={!open.wallet?.pinLocked} onClick={() => unlock.mutate(open.id)}>Unlock PIN</Button>
            </div>
            <div className="rounded-2xl border border-line p-3">
              <div className="eyebrow mb-2">Ledger adjustment (balanced entries against the adjustments account)</div>
              <Field label="Amount (₦)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="soft" disabled={!amount || reason.trim().length < 5} loading={adjust.isPending} onClick={() => adjust.mutate('credit')}>Credit</Button>
                <Button variant="soft" disabled={!amount || reason.trim().length < 5} loading={adjust.isPending} onClick={() => adjust.mutate('debit')}>Debit</Button>
              </div>
            </div>
            <div>
              <div className="eyebrow mb-1">Naira ledger (latest 100 entries, immutable)</div>
              <ul className="divide-y divide-line text-sm">
                {(ledger.data ?? []).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">{e.reason}<span className="block text-xs text-subtle">{ago(e.at)} · {e.txnId.slice(0, 14)}</span></span>
                    <span className="shrink-0 text-right"><span className={cx('num font-semibold', Number(e.amount) < 0 ? 'text-danger' : 'text-success')}>{ngn(e.amount)}</span><span className="num block text-xs text-subtle">bal {ngn(e.balanceAfter)}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Sheet>
    </>
  )
}

function Transactions() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const { data } = useQuery({ queryKey: ['a-naira-txns', status], queryFn: () => api<{ transactions: ATxn[] }>(`/api/admin/naira/transactions${status ? `?status=${status}` : ''}`).then((r) => r.transactions), refetchInterval: 5000 })
  const [open, setOpen] = useState<ATxn | null>(null)
  const [note, setNote] = useState('')
  const detail = useQuery({
    queryKey: ['a-naira-txn', open?.id], enabled: Boolean(open),
    queryFn: () => api<{ ledger: { account: string; amount: string; reason: string; at: number }[] }>(`/api/admin/naira/transactions/${open!.id}`),
  })
  const resolve = useMutation({
    mutationFn: (action: 'approve' | 'reject' | 'refund') => api(`/api/admin/naira/transactions/${open!.id}/resolve`, { method: 'POST', body: { action, note } }),
    onSuccess: () => { toast.success('Done and audited'); setOpen(null); setNote(''); void qc.invalidateQueries({ queryKey: ['a-naira-txns'] }) },
    onError: (e) => toast.error(parseError(e)),
  })
  const canRefund = open && (open.status === 'processing' || (open.status === 'success' && open.direction === 'debit' && !open.reversed))
  return (
    <>
      <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
        {['', 'pending_review', 'processing', 'failed', 'success', 'reversed'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cx('min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold', status === s ? 'border-accent bg-accent text-accent-ink' : 'border-line')}>{s ? (TXN_STATUS[s]?.label ?? s) : 'All'}</button>
        ))}
      </div>
      <Card className="overflow-hidden p-2">
        {data?.length === 0 && <Empty title="No transactions" />}
        {(data ?? []).map((t) => (
          <button key={t.id} onClick={() => setOpen(t)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted">
            <div className="min-w-0"><div className="truncate text-sm font-semibold">{t.title}</div><div className="truncate text-xs text-subtle">{t.email} · {t.reference} · {ago(t.createdAt)}</div></div>
            <div className="shrink-0 text-right"><div className="num text-sm font-semibold">{ngn(t.amount)}</div><Badge kind={TXN_STATUS[t.status]?.kind ?? 'info'}>{TXN_STATUS[t.status]?.label ?? t.status}</Badge></div>
          </button>
        ))}
      </Card>
      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title="Transaction">
        {open && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-muted p-4">
              <Row label="Reference" value={open.reference} mono /><Row label="Customer" value={open.email} /><Row label="Type" value={open.type} /><Row label="Amount" value={ngn(open.amount)} /><Row label="Fee" value={ngn(open.fee)} />
              <Row label="Status" value={TXN_STATUS[open.status]?.label ?? open.status} />{open.failureReason && <Row label="Reason" value={open.failureReason} />}
            </div>
            <div>
              <div className="eyebrow mb-1">Ledger entries</div>
              <ul className="divide-y divide-line text-sm">
                {(detail.data?.ledger ?? []).map((e, i) => <li key={i} className="flex justify-between gap-3 py-2"><span className="min-w-0 truncate">{e.reason}<span className="block text-xs text-subtle">{e.account}</span></span><span className={cx('num shrink-0 font-semibold', Number(e.amount) < 0 ? 'text-danger' : 'text-success')}>{ngn(e.amount)}</span></li>)}
              </ul>
            </div>
            {(open.status === 'pending_review' || canRefund) && (
              <>
                <Field label="Decision note (required, audited)" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  {open.status === 'pending_review' ? (
                    <>
                      <Button disabled={note.trim().length < 5} loading={resolve.isPending} onClick={() => resolve.mutate('approve')}>Approve</Button>
                      <Button variant="danger" disabled={note.trim().length < 5} loading={resolve.isPending} onClick={() => resolve.mutate('reject')}>Reject and refund</Button>
                    </>
                  ) : (
                    <Button className="col-span-2" variant="danger" disabled={note.trim().length < 5} loading={resolve.isPending} onClick={() => resolve.mutate('refund')}>Reverse through the ledger</Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Sheet>
    </>
  )
}

function P2p() {
  const { data } = useQuery({ queryKey: ['a-naira-p2p'], queryFn: () => api<{ orders: { id: string; email: string; asset: string; expected: string; status: string; orderStatus: string; mode: string; txHash: string | null; createdAt: number }[] }>('/api/admin/naira/p2p').then((r) => r.orders), refetchInterval: 4000 })
  return (
    <Card className="overflow-hidden p-2">
      {data?.length === 0 && <Empty title="No P2P deposits yet" />}
      {(data ?? []).map((o) => (
        <div key={o.id} className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 text-sm">
          <div className="min-w-0"><div className="truncate font-semibold">{o.asset} deposit · {o.email}</div><div className="truncate text-xs text-subtle">{o.orderStatus} · {o.mode === 'live' ? 'live testnet' : 'simulated network'} · {ago(o.createdAt)}{o.txHash ? ` · ${o.txHash.slice(0, 12)}…` : ''}</div></div>
          <div className="shrink-0 text-right"><div className="num font-semibold">{ngn(o.expected)}</div><Badge kind={o.status === 'confirmed' ? 'good' : o.status === 'pending' ? 'info' : o.status === 'expired' ? 'warn' : 'bad'}>{o.status}</Badge></div>
        </div>
      ))}
    </Card>
  )
}

function Bills() {
  const { data } = useQuery({ queryKey: ['a-naira-bills'], queryFn: () => api<{ orders: { id: string; reference: string; email: string; category: string; provider: string; product: string | null; customerRef: string | null; amount: string; status: string; providerRef: string | null; createdAt: number }[] }>('/api/admin/naira/bills').then((r) => r.orders), refetchInterval: 5000 })
  return (
    <Card className="overflow-hidden p-2">
      {data?.length === 0 && <Empty title="No bill orders yet" />}
      {(data ?? []).map((o) => (
        <div key={o.id} className="flex min-h-14 items-center justify-between gap-3 px-3 py-2 text-sm">
          <div className="min-w-0"><div className="truncate font-semibold capitalize">{o.category} · {o.provider}</div><div className="truncate text-xs text-subtle">{o.email} · {o.customerRef ?? ''} · {o.reference} · {ago(o.createdAt)}</div></div>
          <div className="shrink-0 text-right"><div className="num font-semibold">{ngn(o.amount)}</div><Badge kind={o.status === 'success' ? 'good' : o.status === 'failed' ? 'bad' : 'info'}>{o.status}</Badge></div>
        </div>
      ))}
    </Card>
  )
}

interface Cfg { bankTransferFee: string; billFee: string; dailySpendLimit: string; reviewThreshold: string; largeFlag: string; pinLockMinutes: number; velocityBlock: number; velocityFlag: number; gasEstimates: Record<string, string>; gasFeeNgn: Record<string, string>; feeBps: number }

function Settings() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['a-naira-config'], queryFn: () => api<{ config: Cfg }>('/api/admin/naira/config').then((r) => r.config) })
  const [draft, setDraft] = useState<Partial<Cfg>>({})
  const [gas, setGas] = useState<Record<string, string>>({})
  const [chainFee, setChainFee] = useState<Record<string, string>>({})
  const { data: registry } = useQuery({ queryKey: ['a-assets-lite'], queryFn: () => api<{ assets: { symbol: string }[] }>('/api/admin/assets').then((r) => r.assets) })
  const { data: nets } = useQuery({ queryKey: ['a-tokens'], queryFn: () => api<{ networks: { id: string; name: string; testnet: boolean }[] }>('/api/admin/tokens') })
  const save = useMutation({
    mutationFn: () => api('/api/admin/naira/config', { method: 'PUT', body: { ...draft, gasEstimates: Object.keys(gas).length ? gas : undefined, gasFeeNgn: Object.keys(chainFee).length ? chainFee : undefined } }),
    onSuccess: () => { toast.success('Saved and audited'); setDraft({}); setGas({}); setChainFee({}); void qc.invalidateQueries({ queryKey: ['a-naira-config'] }) },
    onError: (e) => toast.error(parseError(e)),
  })
  if (!data) return <div className="h-64 animate-pulse rounded-3xl bg-muted" />
  const v = (k: Exclude<keyof Cfg, 'gasEstimates' | 'gasFeeNgn'>) => String(draft[k] ?? data[k])
  const set = (k: Exclude<keyof Cfg, 'gasEstimates' | 'gasFeeNgn'>, n = false) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: n ? Number(e.target.value) : e.target.value.replace(/[^0-9.]/g, '') })
  return (
    <Card className="p-5">
      <p className="mb-4 text-sm text-subtle">Exchange rates for USDC, USDT, BTC and SOL are set in the Rates tab. Everything here takes effect on the next request and is written to the audit log.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bank transfer fee (₦)" inputMode="decimal" value={v('bankTransferFee')} onChange={set('bankTransferFee')} />
        <Field label="Bill service fee (₦)" inputMode="decimal" value={v('billFee')} onChange={set('billFee')} />
        <Field label="Daily spend limit per user (₦)" inputMode="decimal" value={v('dailySpendLimit')} onChange={set('dailySpendLimit')} />
        <Field label="Hold transfers for review at or above (₦)" inputMode="decimal" value={v('reviewThreshold')} onChange={set('reviewThreshold')} />
        <Field label="Flag as large at or above (₦)" inputMode="decimal" value={v('largeFlag')} onChange={set('largeFlag')} />
        <Field label="PIN lock duration (minutes)" inputMode="numeric" value={v('pinLockMinutes')} onChange={set('pinLockMinutes', true)} />
        <Field label="Refuse after this many payments in 10 min" inputMode="numeric" value={v('velocityBlock')} onChange={set('velocityBlock', true)} />
        <Field label="Flag after this many payments in 10 min" inputMode="numeric" value={v('velocityFlag')} onChange={set('velocityFlag', true)} />
      </div>
      <div className="eyebrow mt-5 mb-2">Network fee estimates shown on Fund wallet</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(registry ?? []).map((a) => a.symbol).map((s) => <Field key={s} label={s} inputMode="decimal" value={gas[s] ?? data.gasEstimates[s] ?? ''} onChange={(e) => setGas({ ...gas, [s]: e.target.value.replace(/[^0-9.]/g, '') })} />)}
      </div>
      <div className="eyebrow mt-5 mb-2">Gas fee per chain (₦), added automatically to every buy, sell, exchange and swap</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(nets?.networks ?? []).filter((n) => n.testnet).map((n) => (
          <Field key={n.id} label={n.name} inputMode="decimal" value={chainFee[n.id] ?? data.gasFeeNgn[n.id] ?? ''} onChange={(e) => setChainFee({ ...chainFee, [n.id]: e.target.value.replace(/[^0-9.]/g, '') })} />
        ))}
      </div>
      <Button className="mt-5 w-full" disabled={!Object.keys(draft).length && !Object.keys(gas).length && !Object.keys(chainFee).length} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
    </Card>
  )
}

function Security() {
  const { data } = useQuery({ queryKey: ['a-naira-sec'], queryFn: () => api<{ events: { id: number; at: number; action: string; target: string | null }[]; alerts: { id: number; at: number; severity: string; title: string; detail: string }[]; ledger: { ok: boolean; entries: number } }>('/api/admin/naira/security'), refetchInterval: 6000 })
  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between p-4">
        <div><div className="eyebrow">Ledger integrity</div><div className="text-sm text-subtle">Every transaction nets to zero and cached balances match the entries.</div></div>
        <Badge kind={data?.ledger.ok ? 'good' : 'bad'}>{data ? (data.ledger.ok ? `Balanced (${data.ledger.entries})` : 'MISMATCH') : '...'}</Badge>
      </Card>
      <Card className="p-2">
        <div className="eyebrow px-3 pb-1 pt-2">Fraud and security alerts</div>
        {data?.alerts.length === 0 && <Empty title="No alerts" />}
        {(data?.alerts ?? []).map((a) => <div key={a.id} className="px-3 py-2 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{a.title}</span><span className="text-xs text-subtle">{ago(a.at)}</span></div><div className="text-xs text-subtle">{a.detail}</div></div>)}
      </Card>
      <Card className="p-2">
        <div className="eyebrow px-3 pb-1 pt-2">Audit trail (security and admin actions)</div>
        <ul className="divide-y divide-line">
          {(data?.events ?? []).map((e) => <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="mono truncate">{e.action}</span><span className="shrink-0 text-xs text-subtle">{e.target?.slice(0, 18)} · {ago(e.at)}</span></li>)}
        </ul>
      </Card>
    </div>
  )
}
