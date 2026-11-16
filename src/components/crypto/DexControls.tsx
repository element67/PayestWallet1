import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { NETWORK_NAME, type DexNetwork } from '@/lib/nairaswap'
import { Segmented } from '../ui'

export type Signer = 'app' | 'browser'

/** Network and signing-method pickers shared by the onchain swap and pool screens. */
export function DexControls({ networks, networkId, onNetwork, signer, onSigner }: {
  networks: DexNetwork[]; networkId: string; onNetwork: (id: DexNetwork['id']) => void; signer: Signer; onSigner: (s: Signer) => void
}) {
  const { address, isConnected } = useAccount()
  return (
    <div className="space-y-3">
      <div>
        <span className="eyebrow mb-2 block">Network</span>
        <Segmented value={networkId as DexNetwork['id']} onChange={onNetwork} options={networks.map((n) => ({ value: n.id, label: NETWORK_NAME[n.id] ?? n.id }))} />
      </div>
      <div>
        <span className="eyebrow mb-2 block">Sign with</span>
        <Segmented value={signer} onChange={onSigner} options={[{ value: 'app', label: 'App wallet (PIN)' }, { value: 'browser', label: 'Browser wallet' }]} />
        {signer === 'browser' && (
          <div className="mt-3 flex items-center justify-between gap-3 text-sm">
            <span className="text-subtle">{isConnected ? <>Connected <span className="mono">{address?.slice(0, 6)}…{address?.slice(-4)}</span></> : 'Connect the wallet that will sign'}</span>
            <ConnectKitButton />
          </div>
        )}
      </div>
    </div>
  )
}

export const useBrowserAddress = () => useAccount().address
