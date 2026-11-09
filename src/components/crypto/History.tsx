import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { api } from '@/lib/api'
import { type CryptoTx, statusTone, useCryptoTxs } from '@/lib/crypto'
import { ago, crypto, short } from '@/lib/format'
import { usePrivacy } from '@/lib/privacy'
import { Badge, Card, Empty, Row, Segmented, Sandbox, TokenIcon } from '../ui'

const TYPES = [
  { value: '', label: 'All' }, { value: 'received', label: 'Received' }, { value: 'sent', label: 'Sent' },
  { value: 'swapped', label: 'Swapped' }, { value: 'bridged', label: 'Bridged' }, { value: 'purchased', label: 'Bought' },
]

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { mask } = usePrivacy()
  const { data } = useQuery({
    queryKey: ['crypto-tx', id],
    queryFn: () => api<{ tx: CryptoTx; decisions: { at: number; decision: string; reasons: string[] }[] }>(`/api/crypto/txs/${id}`),
    refetchInterval: 3000,
  })
  const t = data?.tx
  return (
    <Card strong className="p-5">
      <div className="flex items-center justify-between"><h3 className="display text-lg font-semibold">Transaction details</h3><button aria-label="Close" onClick={onClose} className="grid size-9 place-items-center rounded-xl hover:bg-muted"><X size={16} /></button></div>
      {t && (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge kind={statusTone(t.status)}>{t.status}</Badge>
            {t.simulated && <Sandbox label="Simulated event" />}
            {t.verdict === 'unverified_token' && <Badge kind="bad">Unverified token</Badge>}
          </div>
          <div className="mt-3 divide-y divide-line">
            <Row label="Type" value={<span className="capitalize">{t.type}</span>} />
            <Row label="Asset" value={`${mask(crypto(t.amount))} ${t.symbol ?? 'unknown token'}`} />
            <Row label="Network" value={t.network} />
            <Row label="From" value={<span className="break-all">{t.from ?? '-'}</span>} mono />
            <Row label="To" value={<span className="break-all">{t.to ?? '-'}</span>} mono />
            <Row label="Hash" value={t.hash ? <a className="break-all underline" href={t.url ?? '#'} target="_blank" rel="noopener noreferrer">{t.hash}</a> : t.simulated ? 'none (simulated)' : 'not broadcast'} mono />
            {t.tokenRef && <Row label="Token contract" value={<span className="break-all">{t.tokenRef}</span>} mono />}
            <Row label="Network fee" value={t.fee ? `${crypto(t.fee, 8)} ${t.feeSymbol}` : t.type === 'sent' ? 'pending' : 'paid by sender'} />
            <Row label="Confirmations" value={`${t.confirmations} / ${t.finalConfirmations}`} />
            <Row label="Detected" value={new Date(t.detectedAt).toLocaleString()} />
            {t.finalizedAt && <Row label="Finalized" value={new Date(t.finalizedAt).toLocaleString()} />}
            {t.riskScore > 0 && <Row label="Risk score" value={`${t.riskScore} (${t.riskFlags.join(', ')})`} />}
            {t.note && <Row label="Note" value={t.note} />}
          </div>
          {data.decisions.length > 0 && (
            <div className="mt-4">
              <div className="eyebrow mb-1">AI agent decisions</div>
              {data.decisions.map((d, i) => <div key={i} className="py-1 text-sm"><span className="mono text-xs text-subtle">{new Date(d.at).toLocaleTimeString()}</span> {d.decision}{d.reasons.length > 0 && <span className="block text-xs text-subtle">{d.reasons.join(' · ')}</span>}</div>)}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

export function History() {
  const { mask } = usePrivacy()
  const [type, setType] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { data } = useCryptoTxs(type || undefined)
  return (
    <div className="space-y-4">
      <div className="scroll-thin overflow-x-auto"><div className="min-w-[30rem]"><Segmented value={type} onChange={setType} options={TYPES} /></div></div>
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
      <Card className="p-2">
        {!data?.length && (
          <Empty
            title={type ? `No ${type} transactions` : 'No crypto transactions yet'}
            body={['swapped', 'bridged', 'purchased'].includes(type) ? 'Swaps, bridges and purchases appear here once their providers are connected.' : 'Transfers appear as soon as the monitors see them onchain.'}
          />
        )}
        {(data ?? []).map((t) => (
          <button key={t.id} onClick={() => setOpen(t.id)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-muted">
            <TokenIcon symbol={t.symbol ?? '?'} size={34} />
            <div className="min-w-0">
              <div className="text-sm font-semibold capitalize">{t.type} {mask(crypto(t.amount))} {t.symbol ?? 'unknown token'}</div>
              <div className="mono truncate text-xs text-subtle">{t.network} · {t.simulated ? 'simulated' : t.hash ? short(t.hash, 10, 6) : 'not broadcast'} · {ago(t.createdAt)}</div>
              <div className="mono truncate text-xs text-subtle">{t.type === 'received' ? `from ${short(t.from, 8, 6)}` : `to ${short(t.to, 8, 6)}`}{t.fee ? ` · fee ${crypto(t.fee, 6)} ${t.feeSymbol}` : ''}</div>
            </div>
            <Badge kind={t.verdict === 'unverified_token' ? 'bad' : statusTone(t.status)}>{t.verdict === 'unverified_token' ? 'unverified' : t.status}</Badge>
          </button>
        ))}
      </Card>
    </div>
  )
}
