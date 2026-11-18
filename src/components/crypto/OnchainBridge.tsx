import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { ArrowDownUp, ArrowRight, CheckCircle2, CircleDashed, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAccount, useSwitchChain } from 'wagmi'
import { api } from '@/lib/api'
import { parseError } from '@/lib/format'
import { newKey } from '@/lib/naira'
import { NetworkLabel, NetworkPicker } from '../NetworkIcon'
import { PinPad } from '../naira/PinPad'
import { Sheet } from '../naira/Sheet'
import { Button, Card, Field, Row, Segmented } from '../ui'

interface Chain { id: string; name: string; family: 'evm' | 'solana'; kit: string; chainId: number | null; gasSymbol: string }
const STEP_LABEL: Record<string, string> = { approve: 'Approve USDC', burn: 'Burn on source chain', fetchAttestation: "Wait for Circle's proof", mint: 'Mint on destination' }

interface Step { name: string; state: string; txHash?: string; explorerUrl?: string }
interface BridgeOp { id: string; fromName: string; toName: string; amount: string; recipient: string; status: 'running' | 'completed' | 'failed'; steps: Step[]; error: string | null; canRetry: boolean }
interface BridgePreview { from: string; to: string; confirmToken: string; expiresAt: number; fromName: string; toName: string; amount: string; recipient: string; balance: string; warnings: string[] }

function StepList({ steps, running }: { steps: Step[]; running: boolean }) {
  const names = ['approve', 'burn', 'fetchAttestation', 'mint']
  return (
    <ul className="space-y-2">
      {names.map((n) => {
        const s = steps.find((x) => x.name === n)
        const ok = s?.state === 'success'
        const bad = s && s.state !== 'success' && s.state !== 'pending'
        return (
          <li key={n} className="flex items-center gap-3 text-sm">
            {ok ? <CheckCircle2 size={18} className="text-success" /> : bad ? <XCircle size={18} className="text-danger" /> : running && steps.length === names.indexOf(n) ? <Loader2 size={18} className="animate-spin" /> : <CircleDashed size={18} className="text-subtle" />}
            <span className="flex-1 font-semibold">{STEP_LABEL[n]}</span>
            {s?.explorerUrl && <a href={s.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">View <ExternalLink size={12} /></a>}
          </li>
        )
      })}
    </ul>
  )
}

/** Real USDC transfers between the supported test networks over Circle CCTP, signed by the app wallet or a browser wallet (browser wallets cover the EVM networks). */
export function OnchainBridge({ onDone, initialFrom }: { onDone: () => void; initialFrom?: string }) {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['bridge-config'], queryFn: () => api<{ chains: Chain[] }>('/api/bridge/config'), staleTime: 10 * 60_000 })
  const [from, setFrom] = useState(initialFrom ?? 'arc-testnet')
  const [to, setTo] = useState(initialFrom === 'arc-testnet' || !initialFrom ? 'base-sepolia' : 'arc-testnet')
  const [amount, setAmount] = useState('')
  const [signer, setSigner] = useState<'app' | 'browser'>('app')
  const [preview, setPreview] = useState<BridgePreview | null>(null)
  const [pinOpen, setPinOpen] = useState(false)
  const [round, setRound] = useState(0)
  const [opId, setOpId] = useState<string | null>(null)
  const [idem, setIdem] = useState(newKey)
  const { address, isConnected, connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [local, setLocal] = useState<{ status: 'running' | 'completed' | 'failed'; steps: Step[]; error: string | null } | null>(null)

  const chains = cfg?.chains ?? []
  const byId = (id: string) => chains.find((c) => c.id === id)
  const fromChain = byId(from), toChain = byId(to)
  // A browser wallet signs on EVM networks only; the app wallet covers every network, Solana included.
  const choices = signer === 'browser' ? chains.filter((c) => c.family === 'evm') : chains
  const valid = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0 && from !== to && Boolean(fromChain && toChain)
  const flip = () => { setFrom(to); setTo(from); setPreview(null) }
  const other = (id: string) => choices.find((c) => c.id !== id)?.id ?? id
  const chooseSigner = (v: 'app' | 'browser') => {
    setSigner(v)
    setPreview(null)
    if (v === 'browser') {
      const ok = (id: string) => byId(id)?.family === 'evm'
      if (!ok(from)) setFrom('arc-testnet')
      if (!ok(to) || to === 'arc-testnet') setTo('base-sepolia')
    }
  }

  const review = useMutation({
    mutationFn: () => api<{ preview: BridgePreview }>('/api/bridge/preview', { method: 'POST', body: { from, to, amount } }),
    onSuccess: (r) => setPreview(r.preview),
    onError: (e) => toast.error(parseError(e)),
  })
  const start = useMutation({
    mutationFn: (pin: string) => api<{ op: BridgeOp }>('/api/bridge/start', { method: 'POST', body: { from, to, amount, confirmToken: preview?.confirmToken, expiresAt: preview?.expiresAt, pin, idempotencyKey: idem } }),
    onSuccess: (r) => { setPinOpen(false); setOpId(r.op.id) },
    onError: (e) => { toast.error(parseError(e)); setRound((n) => n + 1) },
  })
  const retry = useMutation({
    mutationFn: (pin: string) => api<{ op: BridgeOp }>(`/api/bridge/ops/${opId}/retry`, { method: 'POST', body: { pin } }),
    onSuccess: () => { setPinOpen(false); void qc.invalidateQueries({ queryKey: ['bridge-op', opId] }) },
    onError: (e) => { toast.error(parseError(e)); setRound((n) => n + 1) },
  })
  const { data: op } = useQuery({
    queryKey: ['bridge-op', opId],
    enabled: Boolean(opId),
    queryFn: () => api<{ op: BridgeOp }>(`/api/bridge/ops/${opId}`).then((r) => r.op),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
  })

  /** Browser wallet: the kit runs here and the connected wallet signs each step. Circle's forwarder submits the mint. */
  const runBrowser = async () => {
    if (!connector || !address) return toast.error('Connect the wallet that will sign')
    setLocal({ status: 'running', steps: [], error: null })
    try {
      if (!fromChain?.chainId || !toChain) throw new Error('Choose two EVM networks')
      await switchChainAsync({ chainId: fromChain.chainId })
      const [{ AppKit }, { createViemAdapterFromProvider }] = await Promise.all([import('@circle-fin/app-kit'), import('@circle-fin/adapter-viem-v2')])
      const provider = (await connector.getProvider()) as Parameters<typeof createViemAdapterFromProvider>[0]['provider']
      const adapter = await createViemAdapterFromProvider({ provider })
      const kit = new AppKit()
      const seen: Step[] = []
      kit.on('*', (p: unknown) => {
        const e = p as { method?: string; values?: Record<string, unknown> }
        if (!e.method?.startsWith('bridge.')) return
        const v = e.values ?? {}
        const name = e.method.slice(7)
        const txHash = typeof v.txHash === 'string' ? v.txHash : undefined
        const next: Step = { name, state: typeof v.state === 'string' ? v.state : 'success', txHash, explorerUrl: typeof v.explorerUrl === 'string' ? v.explorerUrl : undefined }
        const i = seen.findIndex((s) => s.name === name)
        if (i >= 0) seen[i] = next; else seen.push(next)
        setLocal({ status: 'running', steps: [...seen], error: null })
      })
      const result = await kit.bridge({
        from: { adapter, chain: fromChain.kit as never },
        to: { recipientAddress: address, chain: toChain.kit as never, useForwarder: true },
        amount,
      })
      const steps = (result.steps as Step[]).map((s) => ({ name: s.name, state: s.state, txHash: s.txHash, explorerUrl: s.explorerUrl }))
      setLocal({ status: result.state === 'success' ? 'completed' : 'failed', steps, error: result.state === 'success' ? null : 'The transfer did not finish. Your funds are safe; check the step that failed.' })
    } catch (e) {
      setLocal((l) => ({ status: 'failed', steps: l?.steps ?? [], error: e instanceof Error ? e.message.slice(0, 200) : 'The wallet rejected the request' }))
    }
  }

  const shown = signer === 'app' ? (op ? { status: op.status, steps: op.steps, error: op.error } : opId ? { status: 'running' as const, steps: [], error: null } : null) : local
  if (shown) {
    return (
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="display text-xl">{shown.status === 'completed' ? 'Bridge complete' : shown.status === 'failed' ? 'Bridge needs attention' : 'Bridging…'}</h2>
          <span className="num text-sm font-semibold">{amount} USDC</span>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-subtle">
          <NetworkLabel id={from} name={fromChain?.name ?? from} /> <ArrowRight size={14} aria-label="to" /> <NetworkLabel id={to} name={toChain?.name ?? to} />
        </p>
        <StepList steps={shown.steps} running={shown.status === 'running'} />
        {shown.error && <p className="text-sm text-danger" role="alert">{shown.error}</p>}
        {shown.status === 'completed' && <p className="text-sm text-subtle">Circle's forwarding fee was taken from the amount, so a little less than {amount} USDC arrives. It can take a minute to show in your balance.</p>}
        <div className="flex gap-2">
          {signer === 'app' && op?.canRetry && <Button className="flex-1" onClick={() => setPinOpen(true)}>Resume with PIN</Button>}
          {signer === 'browser' && shown.status === 'failed' && <Button className="flex-1" onClick={() => void runBrowser()}>Try again</Button>}
          <Button variant={shown.status === 'running' ? 'soft' : 'primary'} className="flex-1" disabled={shown.status === 'running'} onClick={onDone}>Done</Button>
        </div>
        <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Resume bridge"><PinPad key={round} disabled={retry.isPending} onComplete={(pin) => retry.mutate(pin)} /></Sheet>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <NetworkPicker label="From" value={from} options={choices} onChange={(v) => { setFrom(v); if (v === to) setTo(other(v)); setPreview(null) }} />
        <div className="flex justify-center"><button onClick={flip} aria-label="Swap direction" className="grid size-11 place-items-center rounded-full border border-line-strong hover:bg-muted"><ArrowDownUp size={18} /></button></div>
        <NetworkPicker label="To" value={to} options={choices} onChange={(v) => { setTo(v); if (v === from) setFrom(other(v)); setPreview(null) }} />
        <Field label="Amount (USDC)" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setPreview(null) }} />
        <div>
          <span className="eyebrow mb-2 block">Sign with</span>
          <Segmented value={signer} onChange={chooseSigner} options={[{ value: 'app', label: 'App wallet (PIN)' }, { value: 'browser', label: 'Browser wallet' }]} />
          {signer === 'browser' && (
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span className="text-subtle">{isConnected ? <>Connected <span className="mono">{address?.slice(0, 6)}…{address?.slice(-4)}</span></> : 'Connect the wallet that will sign'}</span>
              <ConnectKitButton />
            </div>
          )}
        </div>
      </Card>
      {preview && signer === 'app' && (
        <Card className="space-y-1 p-5">
          <Row label="From" value={<NetworkLabel id={preview.from} name={preview.fromName} />} />
          <Row label="To" value={<NetworkLabel id={preview.to} name={preview.toName} />} />
          <Row label="Amount" value={`${preview.amount} USDC`} />
          <Row label="Sent to" value={<span className="mono text-xs">{preview.recipient.slice(0, 10)}…{preview.recipient.slice(-6)} (your wallet)</span>} />
          <Row label="Balance on source" value={`${preview.balance} USDC`} />
          {preview.warnings.map((w) => <p key={w} className="pt-1 text-xs text-subtle">{w}</p>)}
        </Card>
      )}
      {signer === 'app' ? (
        preview ? <Button className="w-full" onClick={() => { setIdem(newKey()); setPinOpen(true) }}>Confirm with PIN</Button>
          : <Button className="w-full" disabled={!valid || review.isPending} loading={review.isPending} onClick={() => review.mutate()}>Review bridge</Button>
      ) : (
        <Button className="w-full" disabled={!valid || !isConnected} onClick={() => void runBrowser()}>Bridge {amount || ''} USDC</Button>
      )}
      <p className="text-xs text-subtle">USDC moves over Circle's cross-chain protocol: it is burned on the source chain and minted to the same address on the destination. Testnet only. A browser wallet can bridge between the EVM networks; the app wallet can also bridge to and from Solana Devnet.</p>
      <Sheet open={pinOpen && !opId} onClose={() => setPinOpen(false)} title="Confirm bridge">
        {preview && <p className="mb-4 text-center text-sm text-ink-2">Bridge <b>{preview.amount} USDC</b> from <b>{preview.fromName}</b> to <b>{preview.toName}</b>. Enter your 4-digit PIN.</p>}
        <PinPad key={round} disabled={start.isPending} onComplete={(pin) => start.mutate(pin)} />
      </Sheet>
    </div>
  )
}
