/**
 * Every API route, registered once. Importing this module is what makes the routes exist, so both the Next.js route
 * handler (src/app/api/[...path]/route.ts) and the standalone Bun server (server/index.ts) import it.
 */
import './routes'
import './admin'
import './withdrawals'
import './naira/routes'
import './naira/admin'
import './naira/bills'
import './naira/transfers'
import './wallet/routes'
import './tokens/routes'
import './dex/routes'
import './dex/nairaswapRoutes'
import './bridge/routes'
import './adminMonitor'
import './cryptoOps'
import './settings'
import './balance'
import './testCredit'

import { every } from './timers'
import { refreshAssets } from './wallet/networks'
import { clearPortfolioCache } from './wallet/service'

// The token catalog is held in memory. The API (Next.js) and the worker are separate processes, so each loads it now and
// re-reads it every 30 seconds to pick up registry changes made in the other one. A change made in this process applies at once.
await refreshAssets()
const g = globalThis as unknown as { __nbRegistryTimer?: ReturnType<typeof every> }
g.__nbRegistryTimer ??= every('registry-refresh', 30_000, async () => {
  await refreshAssets()
  clearPortfolioCache()
})

export { clientIp, handle } from './http'
