import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Mail, Pencil, Phone, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Empty, Field, PageTitle, Row } from '@/components/ui'
import { api } from '@/lib/api'
import { useSession } from '@/lib/session'

interface Profile {
  fullName: string; email: string; phone: string | null; avatarUrl: string | null
  verificationStatus: string; tier: number; memberSince: number; updatedAt: number
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function ProfileView() {
  const qc = useQueryClient()
  const { user } = useSession()
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['profile', user?.id], queryFn: () => api<{ profile: Profile }>('/api/profile').then((r) => r.profile) })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' })
  const [problem, setProblem] = useState<string | null>(null)

  const startEditing = (p: Profile) => {
    setForm({ fullName: p.fullName, email: p.email, phone: p.phone ?? '' })
    setProblem(null)
    setEditing(true)
  }

  const save = useMutation({
    mutationFn: () => api<{ profile: Profile }>('/api/profile', { method: 'PUT', body: { fullName: form.fullName, email: form.email, phone: form.phone.trim() || null } }),
    onSuccess: (r) => {
      qc.setQueryData(['profile', user?.id], r.profile)
      void qc.invalidateQueries({ queryKey: ['naira'] })
      setEditing(false)
      setProblem(null)
      toast.success('Profile saved')
    },
    onError: (e) => setProblem(e.message),
  })

  const submit = () => {
    if (form.fullName.trim().length < 2) return setProblem('Enter your full name')
    if (!EMAIL.test(form.email.trim())) return setProblem('Enter a valid email address')
    setProblem(null)
    save.mutate()
  }

  if (isLoading) return <><PageTitle title="Profile" /><div className="h-72 animate-pulse rounded-3xl border-3 border-outline bg-card" aria-busy="true" /></>
  if (isError || !data) {
    return (
      <>
        <PageTitle title="Profile" />
        <Card className="p-5">
          <Empty title="Could not load your profile" body={error?.message ?? 'Something went wrong.'} />
          <Button className="mx-auto" onClick={() => void refetch()}>Try again</Button>
        </Card>
      </>
    )
  }

  const verified = data.verificationStatus === 'verified'
  return (
    <>
      <PageTitle title="Profile" sub="How you appear in NairaBridge." />
      <Card strong className="p-5">
        <div className="flex items-center gap-4">
          <div className="display grid size-20 shrink-0 place-items-center rounded-full border-3 border-outline bg-accent text-3xl text-accent-ink shadow-pop" aria-hidden="true">
            {data.avatarUrl ? <img src={data.avatarUrl} alt="" className="size-full rounded-full object-cover" /> : initials(data.fullName)}
          </div>
          <div className="min-w-0">
            <h2 className="display truncate text-2xl">{data.fullName}</h2>
            <div className="mt-1.5">
              <Badge kind={verified ? 'good' : 'warn'}>{verified ? <BadgeCheck size={13} /> : <ShieldAlert size={13} />}{verified ? 'Verified' : 'Not verified'}</Badge>
            </div>
          </div>
        </div>

        {!editing ? (
          <>
            <div className="mt-5 divide-y divide-line">
              <Row label="Email" value={<span className="inline-flex items-center gap-1.5 break-all"><Mail size={14} />{data.email}</span>} />
              <Row label="Phone" value={data.phone ? <span className="inline-flex items-center gap-1.5"><Phone size={14} />{data.phone}</span> : 'Not added'} />
              <Row label="Member since" value={new Date(data.memberSince).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
              <Row label="Verification" value={verified ? `Verified, tier ${data.tier}` : `Tier ${data.tier}, identity check pending`} />
            </div>
            <Button className="mt-5 w-full" onClick={() => startEditing(data)}><Pencil size={16} /> Edit profile</Button>
          </>
        ) : (
          <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); submit() }} noValidate>
            <Field label="Full name" autoComplete="name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} maxLength={80} required />
            <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} hint="Contact email. The email you sign in with does not change." required />
            <Field label="Phone" type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08012345678 or +2348012345678" maxLength={24} />
            {problem && <p role="alert" className="rounded-2xl border-2 border-outline bg-danger px-3 py-2 text-sm font-bold text-on-danger">{problem}</p>}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Button type="button" variant="ghost" onClick={() => { setEditing(false); setProblem(null) }}>Cancel</Button>
              <Button type="submit" loading={save.isPending}>Save</Button>
            </div>
          </form>
        )}
      </Card>
    </>
  )
}
