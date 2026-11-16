import { describe, expect, test } from 'bun:test'
import '../helpers'
import { symbolMatches } from '../../server/tokens/verify'
import { run, now } from '../../server/db'
import { validDestination } from '../../server/vault'

describe('NB-10 token symbols must match exactly', () => {
  test('lookalike symbols are rejected', () => {
    for (const fake of ['FAKE_USDC', 'USDC2', 'TEST_USDT_V2', 'SCAM_ETH', 'xUSDC']) expect(symbolMatches(fake, fake.includes('ETH') ? 'ETH' : fake.includes('USDT') ? 'USDT' : 'USDC')).toBe(false)
  })
  test('the exact symbol (any case) and canonical wrappers are accepted', () => {
    expect(symbolMatches('USDC', 'USDC')).toBe(true)
    expect(symbolMatches('usdc', 'USDC')).toBe(true)
    expect(symbolMatches('USDC.e', 'USDC')).toBe(true)
    expect(symbolMatches('WETH9', 'WETH')).toBe(true)
    expect(symbolMatches('WETH', 'ETH')).toBe(false)
  })
})

describe('NB-11 destination addresses follow the token registry, not a four-symbol list', () => {
  const evm = `0x${'ab'.repeat(20)}`
  test('registry tokens on EVM chains accept EVM addresses', async () => {
    const t = now()
    for (const sym of ['DAI', 'LINK']) {
      await run('INSERT OR IGNORE INTO tokens(symbol,name,decimals,logo,is_active,popular,sort,created_at,updated_at) VALUES (?,?,18,?,1,0,1,?,?)', sym, sym, sym, t, t)
      await run("INSERT OR IGNORE INTO token_networks(symbol,network_id,chain_id,is_testnet,contract,decimals,is_active,verified) VALUES (?,'ethereum-sepolia',11155111,1,?,18,1,1)", sym, evm)
    }
    expect(await validDestination('DAI', evm)).toBe(true)
    expect(await validDestination('LINK', evm)).toBe(true)
    expect(await validDestination('USDC', evm)).toBe(true)
  })
  test('the address format is checked per chain family', async () => {
    expect(await validDestination('DAI', 'not-an-address')).toBe(false)
    expect(await validDestination('USDC', 'So11111111111111111111111111111111111111112')).toBe(false)
    expect(await validDestination('SOL', 'So11111111111111111111111111111111111111112')).toBe(true)
    expect(await validDestination('SOL', evm)).toBe(false)
    expect(await validDestination('BTC', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(true)
  })
  test('an unknown token has no valid destination', async () => {
    expect(await validDestination('NOPE', evm)).toBe(false)
  })
})
