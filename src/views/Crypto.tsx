import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useCrypto } from '@/lib/crypto'
import type { Intent } from '@/lib/nav'
import { BridgeScreen } from '@/components/crypto/BridgeScreen'
import { BuyScreen } from '@/components/crypto/BuyScreen'
import { History } from '@/components/crypto/History'
import { Overview, type CryptoAction } from '@/components/crypto/Overview'
import { Receive } from '@/components/crypto/Receive'
import { Send } from '@/components/crypto/Send'
import { SwapScreen } from '@/components/crypto/SwapScreen'
import { FundSheet } from '@/components/naira/FundSheet'
import { Segmented } from '@/components/ui'
import type { View } from '@/components/Shell'

type Screen = 'send' | 'receive' | 'swap' | 'bridge' | 'buy' | 'sell'
const TITLE: Record<Screen, string> = { send: 'Send', receive: 'Receive', swap: 'Swap', bridge: 'Bridge', buy: 'Buy crypto', sell: 'Sell crypto' }
const isScreen = (s?: string): s is Screen => Boolean(s) && s !== 'transfer' && s !== undefined && s in TITLE

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading wallet">
      <div className="h-40 rounded-3xl bg-muted" />
      <div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="mx-auto size-14 rounded-full bg-muted" />)}</div>
      {[0, 1].map((i) => <div key={i} className="h-32 rounded-3xl bg-muted" />)}
    </div>
  )
}

export function Crypto({ initial, go }: { initial?: Intent['screen']; go: (view: View, intent?: Intent) => void }) {
  const [tab, setTab] = useState<'overview' | 'history'>('overview')
  const [screen, setScreen] = useState<Screen | null>(isScreen(initial) ? initial : null)
  const { data, error, isLoading } = useCrypto()

  const open = (a: CryptoAction) => {
    if (a === 'exchange') return go('exchange', { side: 'sell' })
    if (a === 'history') {
      setScreen(null)
      return setTab('history')
    }
    setScreen(a)
  }
  const close = () => { setScreen(null); setTab('overview') }

  return (
    <>
      <div className="mb-5">
        <button onClick={() => (screen ? close() : go('home'))} className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-ink-2" aria-label={screen ? 'Back to Crypto' : 'Back to Home'}>
          <ArrowLeft size={16} /> {screen ? 'Crypto' : 'Home'}
        </button>
        <h1 className="display text-3xl font-semibold">{screen ? TITLE[screen] : 'Crypto'}</h1>
        {!screen && <p className="text-sm text-subtle">Your own onchain wallet, separate from your Naira wallet.</p>}
      </div>
      {!screen && (
        <div className="mb-5 max-w-xs">
          <Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'history', label: 'History' }]} />
        </div>
      )}
      {isLoading && <Skeleton />}
      {error && <p className="text-danger">{error.message}</p>}
      {data && (
        <>
          {!screen && tab === 'overview' && <Overview data={data} go={open} />}
          {!screen && tab === 'history' && <History />}
          {screen === 'send' && <Send data={data} />}
          {screen === 'receive' && <Receive data={data} />}
          {screen === 'swap' && <SwapScreen onDone={close} />}
          {screen === 'bridge' && <BridgeScreen onDone={close} />}
          {screen === 'buy' && <BuyScreen onDone={close} />}
        </>
      )}
      {screen === 'sell' && <FundSheet open title="Sell crypto" onClose={close} />}
    </>
  )
}
