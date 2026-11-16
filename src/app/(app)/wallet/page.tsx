'use client'

import { Wallet } from '@/views/Wallet'
import { useNav } from '@/lib/navigation'

export default function Page() {
  const { intent, query } = useNav()
  return <Wallet key={query} openTransfer={intent.screen === 'transfer'} />
}
