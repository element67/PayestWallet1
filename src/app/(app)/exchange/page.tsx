'use client'

import { useRouter } from 'next/navigation'
import { Exchange } from '@/views/Exchange'
import { useNav } from '@/lib/navigation'

export default function Page() {
  const { intent, query } = useNav()
  const router = useRouter()
  return <Exchange key={query} focusOrder={intent.order ?? null} clearFocus={() => router.replace('/exchange')} initialSide={intent.side} />
}
