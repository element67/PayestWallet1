'use client'

import { Activity } from '@/views/Activity'
import { useNav } from '@/lib/navigation'

export default function Page() {
  const { go } = useNav()
  return <Activity open={(id) => go('exchange', { order: id })} />
}
