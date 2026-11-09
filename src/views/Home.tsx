import { AlertCircle } from 'lucide-react'
import { ActionGrid, type HomeActionId } from '@/components/home/Actions'
import { AssetsList } from '@/components/home/AssetsList'
import { DashboardCard } from '@/components/home/DashboardCard'
import { P2PCard } from '@/components/home/P2PCard'
import type { Intent } from '@/lib/nav'
import { useHome } from '@/lib/home'
import { useSession } from '@/lib/session'
import type { View } from '@/components/Shell'

export function Home({ go }: { go: (view: View, intent?: Intent) => void }) {
  const { user } = useSession()
  const { data, isError, refetch } = useHome()

  const pick = (id: HomeActionId) => {
    if (id === 'transfer') return go('wallet', { screen: 'transfer' })
    if (id === 'exchange') return go('exchange', { side: 'sell' })
    return go('crypto', { screen: id })
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="eyebrow">Welcome back</div>
        <h1 className="display text-3xl font-semibold leading-tight">{user?.name.split(' ')[0]}</h1>
      </div>
      {isError && (
        <button onClick={() => void refetch()} className="flex min-h-[44px] w-full items-center gap-2 rounded-2xl border border-danger/40 bg-danger/10 px-4 text-left text-sm text-danger">
          <AlertCircle size={16} /> Could not load your balances. Tap to retry.
        </button>
      )}
      <DashboardCard onOpenCrypto={() => go('crypto')} onOpenNaira={() => go('wallet')} />
      <P2PCard onPick={(side) => go('exchange', { side })} />
      <ActionGrid onPick={pick} />
      <AssetsList assets={data?.assets} onViewAll={() => go('crypto')} />
    </div>
  )
}
