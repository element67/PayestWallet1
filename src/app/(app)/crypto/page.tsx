'use client'

import { Crypto } from '@/views/Crypto'
import { useNav } from '@/lib/navigation'

export default function Page() {
  const { go, intent, query } = useNav()
  return <Crypto key={query} initial={intent.screen} address={intent.address} bridgeFrom={intent.from} go={go} />
}
