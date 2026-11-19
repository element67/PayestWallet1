/**
 * Uniswap v3 on test networks. Every address below comes from Uniswap's own published deployment list for that network
 * (docs.uniswap.org, "Uniswap v3 deployments"). Before a network is offered, the server checks on chain that each contract has
 * code and that the quoter points at the same factory, so a wrong address stops the feature instead of misrouting a swap.
 *
 * Arc Testnet is not here on purpose: Uniswap does not support it. Adding a network is one more entry in this list, once its
 * addresses are taken from Uniswap's list and pass the on-chain check.
 */
import { erc20Abi, parseAbi } from 'viem'
import { HttpError } from '../auth'
import { evmClient } from '../wallet/chains'

export interface UniNetwork {
  id: string
  name: string
  factory: `0x${string}`
  quoter: `0x${string}`
  router: `0x${string}`
  explorerTx: string
}

export const UNI_NETWORKS: UniNetwork[] = [
  {
    id: 'ethereum-sepolia', name: 'Ethereum Sepolia',
    factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c', // arc-studio-allow-onchain-literal
    quoter: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3', // arc-studio-allow-onchain-literal
    router: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E', // arc-studio-allow-onchain-literal
    explorerTx: 'https://sepolia.etherscan.io/tx/',
  },
]

export const FEE_TIERS = [100, 500, 3000, 10000] as const
export const ZERO = '0x0000000000000000000000000000000000000000'

export const factoryAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)'])
export const poolAbi = parseAbi(['function liquidity() view returns (uint128)', 'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'])
export const quoterAbi = parseAbi(['function factory() view returns (address)', 'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'])
export const routerAbi = parseAbi([
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
])
export { erc20Abi }

export const uniNetwork = (id: unknown): UniNetwork => {
  const n = UNI_NETWORKS.find((x) => x.id === id)
  if (!n) throw new HttpError(400, 'Uniswap is not available on that network')
  return n
}

const checked = new Map<string, Promise<void>>()

/** Confirms the listed contracts really exist and belong together on this network. Cached after the first success. */
export function verifyDeployment(net: UniNetwork): Promise<void> {
  let p = checked.get(net.id)
  if (!p) {
    p = (async () => {
      const c = evmClient(net.id)
      for (const [what, address] of [['factory', net.factory], ['quoter', net.quoter], ['router', net.router]] as const) {
        const code = await c.getCode({ address })
        if (!code || code === '0x') throw new HttpError(503, `Uniswap ${what} was not found on ${net.name}. Swaps are switched off here.`)
      }
      const f = await c.readContract({ address: net.quoter, abi: quoterAbi, functionName: 'factory' })
      if (f.toLowerCase() !== net.factory.toLowerCase()) throw new HttpError(503, `Uniswap contracts on ${net.name} do not match. Swaps are switched off here.`)
    })()
    p.catch(() => checked.delete(net.id))
    checked.set(net.id, p)
  }
  return p
}
