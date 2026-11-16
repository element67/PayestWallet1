'use client'

import { Home } from '@/views/Home'
import { useNav } from '@/lib/navigation'

export default function Page() {
  const { go } = useNav()
  return <Home go={go} />
}
