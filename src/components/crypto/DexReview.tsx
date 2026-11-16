import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useConfig, useSendTransaction, useSwitchChain } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { parseError } from '@/lib/format'
import { newKey } from '@/lib/naira'
import { executeDex, explorerTx, NETWORK_NAME, SUMMARY_LABELS, summaryValue, type DexPreviewResponse } from '@/lib/nairaswap'
import { PinPad } from '../naira/PinPad'
import { Sheet } from '../naira/Sheet'
import { Button, Card, Row } from '../ui'

const TITLE = { swap: 'Swap', add: 'Add liquidity', remove: 'Remove liquidity' } as const

/**
 * Shows exactly what will be signed, then signs it one of two ways: in the app wallet after a PIN, or in the user's own
 * browser wallet. Nothing is sent before the user presses the confirm button.
 */
export function DexReview({ res, signer, onBack, onDone }: { res: DexPreviewResponse; signer: 'app' | 'browser'; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const cfg = useConfig()
  const { sendTransactionAsync } = useSendTransaction()
  const { switchChainAsync } = useSwitchChain()
  const [pinOpen, setPinOpen] = useState(false)
  const [round, setRound] = useState(0)
  const [idem] = useState(newKey)
  const [hashes, setHashes] = useState<string[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const p = res.preview
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['dex-pools'] }); void qc.invalidateQueries({ queryKey: ['crypto'] }) }

  const app = useMutation({
    mutationFn: (pin: string) => executeDex({ networkId: p.networkId, params: p.params, expiresAt: res.expiresAt, confirmToken: res.confirmToken ?? '', pin, idempotencyKey: idem }),
    onSuccess: (r) => { setPinOpen(false); setHashes(r.op.hashes); refresh() },
    onError: (e) => { toast.error(parseError(e)); setRound((n) => n + 1) },
  })

  const browser = useMutation({
    mutationFn: async () => {
      await switchChainAsync({ chainId: p.chainId })
      const done: string[] = []
      for (const [i, s] of p.steps.entries()) {
        setProgress(`${s.label} (${i + 1} of ${p.steps.length}): confirm in your wallet`)
        const hash = await sendTransactionAsync({ to: s.to, data: s.data, value: 0n, chainId: p.chainId })
        done.push(hash)
        setHashes([...done])
        setProgress(`${s.label}: waiting for confirmation`)
        const receipt = await waitForTransactionReceipt(cfg, { hash, chainId: p.chainId })
        if (receipt.status !== 'success') throw new Error(`${s.label} failed onchain`)
      }
    },
    onSuccess: () => { setProgress(null); refresh() },
    onError: (e) => { setProgress(null); toast.error(parseError(e)) },
  })

  const finished = hashes.length > 0 && (signer === 'app' ? app.isSuccess : browser.isSuccess)
  if (finished) {
    return (
      <Card className="space-y-4 p-5 text-center">
        <CheckCircle2 className="mx-auto text-success" size={40} aria-hidden />
        <h2 className="display text-2xl">{TITLE[p.kind]} complete</h2>
        <div className="space-y-1 text-sm">
          {hashes.map((h) => (
            <a key={h} href={explorerTx(p.networkId, h)} target="_blank" rel="noreferrer" className="mono inline-flex items-center justify-center gap-1 break-all text-accent underline">{h.slice(0, 10)}…{h.slice(-6)} <ExternalLink size={12} aria-hidden /></a>
          ))}
        </div>
        <Button className="w-full" onClick={onDone}>Done</Button>
      </Card>
    )
  }

  const busy = app.isPending || browser.isPending
  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-5">
        <div className="mb-1 flex items-center justify-between">
          <span className="eyebrow">Review {TITLE[p.kind].toLowerCase()}</span>
          <span className="text-xs font-bold text-subtle">{NETWORK_NAME[p.networkId]}</span>
        </div>
        {Object.entries(p.summary).map(([k, v]) => <Row key={k} label={SUMMARY_LABELS[k] ?? k} value={<span className="num font-semibold">{summaryValue(k, v)}</span>} />)}
        <Row label="Signed by" value={signer === 'app' ? 'Your app wallet (PIN)' : 'Your browser wallet'} />
        <Row label="Wallet steps" value={p.steps.map((s) => s.label).join(' → ')} />
      </Card>
      <Card className="space-y-2 p-5 text-sm">
        {p.warnings.map((w) => <p key={w} className="text-ink-2">{w}</p>)}
        <p className="flex items-center gap-2 text-xs text-subtle"><ShieldCheck size={14} aria-hidden /> Approvals are for this exact amount only. The router refuses the trade if the price moves past your limit or after 10 minutes.</p>
      </Card>
      {progress && <p className="text-center text-sm font-semibold text-ink-2" role="status">{progress}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Button variant="soft" disabled={busy} onClick={onBack}>Back</Button>
        <Button loading={busy} onClick={() => (signer === 'app' ? setPinOpen(true) : browser.mutate())}>{signer === 'app' ? 'Confirm with PIN' : 'Sign in wallet'}</Button>
      </div>
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Confirm with PIN">
        <p className="mb-4 text-center text-sm text-ink-2">{TITLE[p.kind]} on {NETWORK_NAME[p.networkId]}. Enter your 4-digit PIN.</p>
        <PinPad key={round} disabled={app.isPending} onComplete={(pin) => app.mutate(pin)} />
      </Sheet>
    </div>
  )
}
