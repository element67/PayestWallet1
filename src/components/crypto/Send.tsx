import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { type CryptoOverview, type CryptoTx, type SendPreview, statusTone } from '@/lib/crypto'
import { crypto, short } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { Badge, Button, Card, Field, Row, TokenIcon } from '../ui'

const newKey = () => `send-${globalThis.crypto.randomUUID()}`

export function Send({ data }: { data: CryptoOverview }) {
  const { mask } = usePrivacy()
  const qc = useQueryClient()
  const networks = data.networks
  const [networkId, setNetworkId] = useState(networks.find((n) => n.canSend)?.id ?? networks[0].id)
  const net = networks.find((n) => n.id === networkId) ?? networks[0]
  const assets = data.assets.filter((a) => a.network === networkId)
  const [assetKey, setAssetKey] = useState('')
  const asset = assets.find((a) => a.key === assetKey) ?? assets[0]
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [preview, setPreview] = useState<SendPreview | null>(null)
  const [idem, setIdem] = useState(newKey)
  const [sentId, setSentId] = useState<string | null>(null)

  const prepare = useMutation({
    mutationFn: () => api<{ preview: SendPreview }>('/api/crypto/send/prepare', { method: 'POST', body: { networkId, assetKey: asset.key, to: to.trim(), amount } }),
    onSuccess: (r) => setPreview(r.preview),
    onError: (e) => toast.error(e.message),
  })
  const send = useMutation({
    mutationFn: (p: SendPreview) =>
      api<{ tx: CryptoTx }>('/api/crypto/send', {
        method: 'POST',
        body: { networkId: p.networkId, assetKey: p.assetKey, to: p.to, amount: p.amount, confirmToken: p.confirmToken, expiresAt: p.expiresAt, idempotencyKey: idem },
      }),
    onSuccess: (r) => {
      setSentId(r.tx.id)
      void qc.invalidateQueries({ queryKey: ['crypto'] })
      void qc.invalidateQueries({ queryKey: ['crypto-txs'] })
    },
    onError: (e) => {
      toast.error(e.message)
      setPreview(null)
    },
  })

  if (sentId) return <Tracker id={sentId} onDone={() => { setSentId(null); setPreview(null); setAmount(''); setTo(''); setIdem(newKey()) }} />

  if (preview) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <button onClick={() => setPreview(null)} className="flex min-h-10 items-center gap-2 text-sm font-semibold text-ink-2"><ArrowLeft size={16} /> Edit transfer</button>
        <Card strong className="p-6">
          <h2 className="display text-xl font-semibold">Confirm transfer</h2>
          <div className="display num mt-3 text-4xl font-semibold">{crypto(preview.amount)} {preview.asset}</div>
          <div className="mt-4 divide-y divide-line">
            <Row label="Network" value={preview.network} />
            <Row label="From" value={short(preview.from, 10, 6)} mono />
            <Row label="To" value={<span className="break-all">{preview.to}</span>} mono />
            <Row label="Network fee (estimate)" value={`${crypto(preview.fee, 8)} ${preview.feeSymbol}`} />
            <Row label="Gas" value={`${preview.gasUnits} units at ${crypto(preview.gasPriceGwei, 4)} gwei`} />
            <Row label="Your balance" value={`${mask(crypto(preview.balance))} ${preview.asset}`} />
          </div>
          {preview.warnings.map((w) => (
            <div key={w} className="mt-3 flex gap-2 rounded-2xl bg-warn/10 p-3 text-sm text-warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{w}</div>
          ))}
          <p className="mt-3 text-xs text-subtle">Blockchain transfers cannot be reversed. This confirmation is valid for 2 minutes. Signing happens on the server; your keys never reach this page.</p>
          <Button className="mt-4 w-full" loading={send.isPending} onClick={() => send.mutate(preview)}>Confirm and send</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card strong className="space-y-4 p-6">
        <div>
          <div className="eyebrow mb-1.5">Network</div>
          <select value={networkId} onChange={(e) => { setNetworkId(e.target.value); setAssetKey('') }} className="min-h-11 w-full rounded-2xl border border-line bg-surface-strong px-3 text-sm" aria-label="Network">
            {networks.map((n) => <option key={n.id} value={n.id}>{n.name}{n.canSend ? '' : ' (send not enabled)'}</option>)}
          </select>
          {!net.canSend && <p className="mt-2 text-sm text-warn">{net.sendNote}</p>}
        </div>
        <div>
          <div className="eyebrow mb-1.5">Asset</div>
          <div className="flex flex-wrap gap-2">
            {assets.map((a) => (
              <button key={a.key} onClick={() => setAssetKey(a.key)} className={`flex min-h-11 items-center gap-2 rounded-2xl border px-3 text-sm font-semibold ${asset?.key === a.key ? 'border-line-strong bg-surface-strong' : 'border-line hover:bg-muted'}`}>
                <TokenIcon symbol={a.symbol} size={20} />{a.symbol}<span className="num text-xs font-normal text-subtle">{a.balance === null ? '...' : mask(crypto(a.balance, 6))}</span>
              </button>
            ))}
          </div>
        </div>
        <Field label="Recipient address" value={to} onChange={(e) => setTo(e.target.value)} placeholder={net.family === 'evm' ? '0x...' : 'Address'} className="mono !text-xs" autoComplete="off" spellCheck={false} />
        <Field label={`Amount (${asset?.symbol})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} hint={asset?.balance !== null ? `Available ${mask(crypto(asset?.balance ?? '0'))} ${asset?.symbol}${net.id === 'arc-testnet' ? ' (gas is paid in USDC from the same balance)' : ''}` : undefined} />
        <Button className="w-full" disabled={!net.canSend || !to || !amount || Number(amount) <= 0} loading={prepare.isPending} onClick={() => prepare.mutate()}>Review transfer</Button>
      </Card>
    </div>
  )
}

function Tracker({ id, onDone }: { id: string; onDone: () => void }) {
  const { data } = useQuery({ queryKey: ['crypto-tx', id], queryFn: () => api<{ tx: CryptoTx }>(`/api/crypto/txs/${id}`).then((r) => r.tx), refetchInterval: 2000 })
  const done = data && ['finalized', 'failed', 'dropped'].includes(data.status)
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card strong className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="display text-xl font-semibold">Transfer status</h2>
          {data && <Badge kind={statusTone(data.status)}>{data.status}</Badge>}
        </div>
        {!data ? <Loader2 className="mt-4 animate-spin" /> : (
          <>
            <div className="display num mt-3 text-3xl font-semibold">{crypto(data.amount)} {data.symbol}</div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              {data.status === 'finalized' ? <Check size={16} className="text-success" /> : done ? <AlertTriangle size={16} className="text-danger" /> : <Loader2 size={16} className="animate-spin" />}
              {data.status === 'signing' && 'Signing and broadcasting...'}
              {data.status === 'pending' && 'Broadcast. Waiting for the network to include it.'}
              {data.status === 'confirmed' && `Included in a block. ${data.confirmations} of ${data.finalConfirmations} confirmations.`}
              {data.status === 'finalized' && 'Final.'}
              {(data.status === 'failed' || data.status === 'dropped') && (data.note ?? 'The transfer did not complete.')}
            </div>
            <div className="mt-4 divide-y divide-line">
              <Row label="Network" value={data.network} />
              <Row label="To" value={<span className="break-all">{data.to}</span>} mono />
              <Row label="Transaction hash" value={data.hash ? <a className="break-all underline" href={data.url ?? '#'} target="_blank" rel="noopener noreferrer">{data.hash}</a> : 'pending broadcast'} mono />
              {data.fee && <Row label="Network fee paid" value={`${crypto(data.fee, 8)} ${data.feeSymbol}`} />}
            </div>
          </>
        )}
        {done && <Button className="mt-4 w-full" variant="ghost" onClick={onDone}>Done</Button>}
      </Card>
    </div>
  )
}
