import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The admin area is private: keep it out of search engines and give it its own tab title.
export const metadata: Metadata = { title: 'NairaBridge Admin', robots: { index: false, follow: false } }

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children
}
