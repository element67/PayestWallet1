/** Read-only onchain price quotes from AchSwap on Arc Testnet. Nothing here moves funds. */
import { z } from 'zod'
import { HttpError } from '../auth'
import { body, route } from '../http'
import { DexError, quoteDirect } from './achswap'

route('POST', '/api/dex/quote', 'user', async (c) => {
  const b = body(c, z.object({
    tokenIn: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Enter a valid token address'),
    tokenOut: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Enter a valid token address'),
    amountIn: z.string().regex(/^\d{1,30}$/, 'Amount must be in the token\'s smallest unit'),
  }))
  try {
    return { quote: await quoteDirect(b.tokenIn, b.tokenOut, BigInt(b.amountIn)) }
  } catch (e) {
    if (e instanceof DexError) throw new HttpError(400, e.message)
    throw new HttpError(502, 'Could not read AchSwap right now. Try again in a moment.')
  }
}, [30, 60_000])
