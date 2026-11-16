import { LayoutDashboard, LogOut } from 'lucide-react'
import { Card, PageTitle } from '@/components/ui'
import { ListRow } from '@/components/settings/Pieces'
import { ADMIN_URL, moreItems, type View } from '@/components/Shell'
import type { Intent } from '@/lib/nav'
import { useNotifications } from '@/lib/queries'
import { useSession } from '@/lib/session'

const DETAIL: Partial<Record<View, string>> = {
  profile: 'Your name, contact details and verification',
  settings: 'Display, notifications, security and help',
  activity: 'Every exchange, with live status',
  alerts: 'Payout updates and security alerts',
}

/** The More tab: everything that is not one of the four main tabs. */
export function MoreView({ go }: { go: (v: View, i?: Intent) => void }) {
  const { user, signOut } = useSession()
  const { data: notes } = useNotifications()
  const unread = notes?.filter((n) => !n.read).length ?? 0
  const items = moreItems
  return (
    <>
      <PageTitle title="More" sub="Profile, settings and everything else." />
      <Card className="divide-y divide-line p-2">
        {items.map((n) => (
          <ListRow
            key={n.id}
            icon={<n.icon size={20} />}
            label={n.label}
            detail={DETAIL[n.id]}
            onClick={() => go(n.id)}
            badge={n.id === 'alerts' && unread > 0 ? <span className="rounded-full border-2 border-outline bg-danger px-2 text-xs font-extrabold text-on-danger">{unread}</span> : undefined}
          />
        ))}
        {user?.role === 'founder' && <ListRow icon={<LayoutDashboard size={20} />} label="Admin dashboard" detail="Monitoring, rates, limits and risk, in its own area" onClick={() => window.location.assign(ADMIN_URL)} />}
        <ListRow icon={<LogOut size={20} />} label="Sign out" detail={user?.email} onClick={() => void signOut()} />
      </Card>
    </>
  )
}
