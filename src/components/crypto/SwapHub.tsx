import { useState } from 'react'
import { Segmented } from '../ui'
import { CircleSwap } from './CircleSwap'
import { OnchainSwap } from './OnchainSwap'
import { Pools } from './Pools'
import { SwapScreen } from './SwapScreen'

type Mode = 'balances' | 'onchain' | 'circle' | 'pools'

/** One Swap screen with four modes: exchange balances (founder rates), onchain swaps, Circle swaps, and liquidity pools. */
export function SwapHub({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('balances')
  return (
    <div className="space-y-4">
      <Segmented value={mode} onChange={setMode} options={[{ value: 'balances', label: 'Exchange balances' }, { value: 'onchain', label: 'Onchain swap' }, { value: 'circle', label: 'Circle swap' }, { value: 'pools', label: 'Pools' }]} />
      {mode === 'balances' && <SwapScreen onDone={onDone} />}
      {mode === 'onchain' && <OnchainSwap onDone={onDone} />}
      {mode === 'circle' && <CircleSwap onDone={onDone} />}
      {mode === 'pools' && <Pools onDone={onDone} />}
    </div>
  )
}
