'use client'

import { SettingsView } from '@/views/SettingsView'
import { useNav } from '@/lib/navigation'

export default function Page() {
  const { intent, query } = useNav()
  return <SettingsView key={query} initial={intent.settings} />
}
