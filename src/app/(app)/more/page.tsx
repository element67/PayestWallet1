'use client'

import { MoreView } from '@/views/MoreView'
import { useNav } from '@/lib/navigation'

export default function Page() {
  const { go } = useNav()
  return <MoreView go={go} />
}
