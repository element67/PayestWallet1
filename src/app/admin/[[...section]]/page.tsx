'use client'

import dynamic from 'next/dynamic'
import { AppSkeleton } from '@/components/AppSkeleton'

// The dashboard needs browser APIs (session storage), so nothing renders on the server. Access is enforced twice: the
// screen checks the founder role, and every /api/admin route refuses anyone who is not a founder.
const AdminRoot = dynamic(() => import('@/admin/AdminRoot'), { ssr: false, loading: () => <AppSkeleton /> })

export default function Page() {
  return <AdminRoot />
}
