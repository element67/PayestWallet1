/**
 * The providers shown in the "Powered by" row under the swap card. One array drives the row: a provider whose status is "live"
 * shows its full-color logo, one that is "soon" shows a grayscale logo at low opacity (on hold until mainnet). To bring a provider
 * live at mainnet launch, set ENABLE_MAINNET_INTEGRATIONS (NEXT_PUBLIC_ENABLE_MAINNET_INTEGRATIONS) to "true", or change one status here. The layout does not change.
 *
 * ENABLE_MAINNET_INTEGRATIONS defaults to false. The same flag, read from the server's environment, keeps the other swap integrations
 * (Circle swaps, LI.FI, AchSwap) switched off in the trade module; their code stays in place.
 *
 * Logos are the providers' official files, unmodified, in /public/assets/providers (see the README there).
 */
export const ENABLE_MAINNET_INTEGRATIONS = process.env.NEXT_PUBLIC_ENABLE_MAINNET_INTEGRATIONS === 'true'

export type ProviderStatus = 'live' | 'soon'
export interface PoweredProvider {
  id: string
  /** Read by screen readers only; never drawn as visible text. */
  name: string
  /** Logo for light mode and for dark mode. A dark logo gets its white variant on dark backgrounds. */
  logoLight: string
  logoDark: string
  status: ProviderStatus
}

const DIR = '/assets/providers'
const held: ProviderStatus = ENABLE_MAINNET_INTEGRATIONS ? 'live' : 'soon'

export const POWERED_BY: PoweredProvider[] = [
  { id: 'uniswap', name: 'Uniswap', logoLight: `${DIR}/uniswap-horizontal-pink.svg`, logoDark: `${DIR}/uniswap-horizontal-pink.svg`, status: 'live' },
  { id: 'lifi', name: 'LI.FI', logoLight: `${DIR}/lifi-horizontal-black.svg`, logoDark: `${DIR}/lifi-horizontal-white.svg`, status: held },
  { id: 'kyberswap', name: 'KyberSwap', logoLight: `${DIR}/kyberswap-mark.svg`, logoDark: `${DIR}/kyberswap-mark-white.svg`, status: held },
  { id: 'circle', name: 'Circle', logoLight: `${DIR}/circle-logo-dark.svg`, logoDark: `${DIR}/circle-logo-white.svg`, status: held },
  { id: 'achswap', name: 'AchSwap', logoLight: `${DIR}/achswap-lockup-blue.svg`, logoDark: `${DIR}/achswap-lockup-white.svg`, status: held },
]

/**
 * The "Powered by" row on the Bridge screen. Circle's cross-chain protocol does the bridging today (live on the test networks);
 * LI.FI is built for other routes and stays on hold until mainnet, behind the same flag as above.
 */
export const BRIDGE_POWERED_BY: PoweredProvider[] = [
  { id: 'circle', name: 'Circle', logoLight: `${DIR}/circle-logo-dark.svg`, logoDark: `${DIR}/circle-logo-white.svg`, status: 'live' },
  { id: 'lifi', name: 'LI.FI', logoLight: `${DIR}/lifi-horizontal-black.svg`, logoDark: `${DIR}/lifi-horizontal-white.svg`, status: held },
]
