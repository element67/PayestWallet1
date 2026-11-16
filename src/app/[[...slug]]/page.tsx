'use client'

import dynamic from 'next/dynamic'
import { AppSkeleton } from '@/components/AppSkeleton'

// Stage 3 of the Next.js move: the existing screens run unchanged inside one client page. They need browser APIs
// (wallet, sessionStorage), so nothing here renders on the server. Stage 5 replaces this with one route per screen.
const AppRoot = dynamic(() => import('@/AppRoot'), { ssr: false, loading: () => <AppSkeleton /> })

export default function Page() {
  return <AppRoot />
}
