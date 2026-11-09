/**
 * Initial token registry. Native tokens and USDC come from the verified chain registry. Every other contract below is a
 * candidate that stays inactive until it is checked ON-CHAIN (code exists, symbol and decimals match) by verify.ts.
 * Mainnet rows are reference data only and are never active while the platform runs in sandbox mode.
 */
import { getAddress } from 'viem'
import { getUsdc } from '../../src/onchain-facts'
import { db, now, run } from '../db'
import { REG_NETWORKS } from './networks'

/** symbol, name, decimals, popular, sort */
const TOKENS: Array<[string, string, number, number, number]> = [
  ['USDC', 'USD Coin', 6, 1, 1], ['USDT', 'Tether USD', 6, 1, 2], ['ETH', 'Ether', 18, 1, 3], ['BTC', 'Bitcoin', 8, 1, 4],
  ['SOL', 'Solana', 9, 1, 5], ['DAI', 'Dai', 18, 1, 6], ['WBTC', 'Wrapped Bitcoin', 8, 1, 7],
  ['WETH', 'Wrapped Ether', 18, 0, 10], ['BNB', 'BNB', 18, 0, 11], ['POL', 'POL (ex-MATIC)', 18, 0, 12], ['LINK', 'Chainlink', 18, 0, 13],
  ['UNI', 'Uniswap', 18, 0, 14], ['AAVE', 'Aave', 18, 0, 15], ['ARB', 'Arbitrum', 18, 0, 16], ['OP', 'Optimism', 18, 0, 17],
  ['EURC', 'Euro Coin (EURO)', 6, 0, 18], ['cbBTC', 'Coinbase Wrapped BTC', 8, 0, 19],
]

/** Native assets by network. */
const NATIVE: Array<[string, string[]]> = [
  ['ETH', ['ethereum-sepolia', 'ethereum', 'base-sepolia', 'base', 'arbitrum-sepolia', 'arbitrum', 'optimism-sepolia', 'optimism']],
  ['POL', ['polygon-amoy', 'polygon']], ['BNB', ['bnb']], ['SOL', ['solana-devnet']], ['BTC', ['bitcoin-testnet']],
]

/** [symbol, network, contract]. Unverified until the on-chain check passes. */
const CANDIDATES: Array<[string, string, string]> = [
  ['USDT', 'ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7'], ['DAI', 'ethereum', '0x6B175474E89094C44Da98b954EedeAC495271d0F'],
  ['WETH', 'ethereum', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'], ['WBTC', 'ethereum', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'],
  ['LINK', 'ethereum', '0x514910771AF9Ca656af840dff83E8264EcF986CA'], ['UNI', 'ethereum', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'],
  ['AAVE', 'ethereum', '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'], ['EURC', 'ethereum', '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c'],
  ['cbBTC', 'ethereum', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'],
  ['WETH', 'base', '0x4200000000000000000000000000000000000006'], ['DAI', 'base', '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'],
  ['EURC', 'base', '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42'], ['cbBTC', 'base', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'],
  ['LINK', 'base', '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196'],
  ['USDT', 'arbitrum', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'], ['DAI', 'arbitrum', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'],
  ['WETH', 'arbitrum', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'], ['WBTC', 'arbitrum', '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f'],
  ['LINK', 'arbitrum', '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4'], ['UNI', 'arbitrum', '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0'],
  ['AAVE', 'arbitrum', '0xba5DdD1f9d7F570dc94a51479a000E3BCE967196'], ['ARB', 'arbitrum', '0x912CE59144191C1204E64559FE8253a0e49E6548'],
  ['USDT', 'optimism', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'], ['DAI', 'optimism', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'],
  ['WETH', 'optimism', '0x4200000000000000000000000000000000000006'], ['WBTC', 'optimism', '0x68f180fcCe6836688e9084f035309E29Bf0A2095'],
  ['LINK', 'optimism', '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6'], ['UNI', 'optimism', '0x6fd9d7AD17242c41f7131d257212c54A0e816691'],
  ['AAVE', 'optimism', '0x76FB31fb4af56892A25e32cFC43De717950c9278'], ['OP', 'optimism', '0x4200000000000000000000000000000000000042'],
  ['USDT', 'polygon', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'], ['DAI', 'polygon', '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'],
  ['WETH', 'polygon', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'], ['WBTC', 'polygon', '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6'],
  ['LINK', 'polygon', '0xb0897686c545045aFc77CF20eC7A532E3120E0F1'], ['UNI', 'polygon', '0xb33EaAd8d922B1083446DC23f610c2567fB5180f'],
  ['AAVE', 'polygon', '0xD6DF932A45C0f255f85145f286eA0b292B21C90B'],
  ['USDT', 'bnb', '0x55d398326f99059fF775485246999027B3197955'], ['DAI', 'bnb', '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3'],
  ['LINK', 'bnb', '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD'], ['UNI', 'bnb', '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1'],
  ['AAVE', 'bnb', '0xfb6115445Bff7b52FeB98650C87f44907E58f802'],
  // Testnets
  ['WETH', 'ethereum-sepolia', '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'], ['LINK', 'ethereum-sepolia', '0x779877A7B0D9E8603169DdbD7836e478b4624789'],
  ['EURC', 'ethereum-sepolia', '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4'], ['UNI', 'ethereum-sepolia', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'],
  ['WETH', 'base-sepolia', '0x4200000000000000000000000000000000000006'], ['EURC', 'base-sepolia', '0x808456652fdb597867f38412077A9182bf77359F'],
  ['LINK', 'base-sepolia', '0xE4aB69C077896252FAFBD49EFD26B5D171A32410'],
  ['WETH', 'optimism-sepolia', '0x4200000000000000000000000000000000000006'], ['OP', 'optimism-sepolia', '0x4200000000000000000000000000000000000042'],
  ['LINK', 'optimism-sepolia', '0xE4aB69C077896252FAFBD49EFD26B5D171A32410'],
  ['WETH', 'arbitrum-sepolia', '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'], ['LINK', 'arbitrum-sepolia', '0xb1D4538B4571d411F07960EF2838Ce337FE1E80E'],
  ['LINK', 'polygon-amoy', '0x0Fd9e8d3aF1aaee056EB9e802c3A762a667b1904'],
  ['EURC', 'arc-testnet', '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'],
]

export function seedTokens() {
  const t = now()
  const decimalsOf = new Map(TOKENS.map(([s, , d]) => [s, d]))
  db.transaction(() => {
    for (const [symbol, name, decimals, popular, sort] of TOKENS) {
      run('INSERT OR IGNORE INTO tokens(symbol,name,decimals,logo,is_active,popular,sort,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?,?)', symbol, name, decimals, symbol, popular, sort, t, t)
    }
    const dep = (symbol: string, networkId: string, contract: string | null, decimals: number, verified: boolean, source: string) => {
      const n = REG_NETWORKS.find((x) => x.id === networkId)
      if (!n) return
      // Sandbox: only verified TESTNET deployments are ever switched on automatically.
      const active = verified && n.testnet ? 1 : 0
      run(
        `INSERT OR IGNORE INTO token_networks(symbol,network_id,chain_id,is_testnet,contract,decimals,is_active,verified,verified_at,verify_note,source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        symbol, networkId, n.chainId, n.testnet ? 1 : 0, contract, decimals, active, verified ? 1 : 0, verified ? t : null, verified ? `Registered from ${source}` : 'Waiting for the on-chain check', source,
      )
    }
    for (const [symbol, networks] of NATIVE) for (const id of networks) dep(symbol, id, null, decimalsOf.get(symbol) ?? 18, true, 'the chain itself (native asset)')
    for (const n of REG_NETWORKS) {
      const u = n.chainId ? getUsdc(n.chainId) : undefined
      if (u) dep('USDC', n.id, getAddress(u.address), u.decimals, true, 'the verified chain registry')
    }
    for (const [symbol, networkId, contract] of CANDIDATES) dep(symbol, networkId, getAddress(contract.toLowerCase()), decimalsOf.get(symbol) ?? 18, false, 'seed')
  })()
}
