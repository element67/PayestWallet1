'use client'

import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'
import { AppSkeleton } from '@/components/AppSkeleton'

// The customer app needs browser APIs (wallet, session storage), so the shared frame loads in the browser only.
// Each page below renders inside it, which means the frame, wallet and session persist while you move between screens.
const AppFrame = dynamic(() => import('@/AppFrame'), { ssr: false, loading: () => <AppSkeleton /> })

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>
}
