import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Camera, Mail, Pencil, Phone, ShieldAlert, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { Badge, Button, Card, Empty, Field, PageTitle, Row } from '@/components/ui'
import { api } from '@/lib/api'
import type { Profile } from '@/lib/profile'
import { useSession } from '@/lib/session'

/** Crops to a centred square and shrinks the picture so it stays small enough to save (the server accepts at most 40 KB). */
async function toAvatar(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture')
  if (file.size > 15 * 1024 * 1024) throw new Error('That picture is too large')
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  for (const [px, q] of [[256, 0.85], [256, 0.7], [192, 0.7], [160, 0.6], [128, 0.55]] as const) {
    const canvas = document.createElement('canvas')
    canvas.width = px
    canvas.height = px
    const ctx = canvas.getContext('2d')
    if (!ctx) break
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, px, px)
    const url = canvas.toDataURL('image/jpeg', q)
    if (url.length * 0.75 < 38_000) return url
  }
  throw new Error('That picture could not be made small enough. Try another one')
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function ProfileView() {
  const qc = useQueryClient()
  const { user } = useSession()
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['profile', user?.id], queryFn: () => api<{ profile: Profile }>('/api/profile').then((r) => r.profile) })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', currentPassword: '' })
  const [problem, setProblem] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const saveAvatar = useMutation({
    mutationFn: async (file: File) => api<{ profile: Profile }>('/api/profile/avatar', { method: 'PUT', body: { image: await toAvatar(file) } }),
    onSuccess: (r) => { qc.setQueryData(['profile', user?.id], r.profile); toast.success('Picture saved') },
    onError: (e) => toast.error(e.message),
  })
  const removeAvatar = useMutation({
    mutationFn: () => api<{ profile: Profile }>('/api/profile/avatar', { method: 'DELETE' }),
    onSuccess: (r) => { qc.setQueryData(['profile', user?.id], r.profile); toast.success('Picture removed') },
    onError: (e) => toast.error(e.message),
  })

  const startEditing = (p: Profile) => {
    setForm({ fullName: p.fullName, email: p.email, phone: p.phone ?? '', currentPassword: '' })
    setProblem(null)
    setEditing(true)
  }

  const save = useMutation({
    mutationFn: () => api<{ profile: Profile }>('/api/profile', { method: 'PUT', body: { fullName: form.fullName, email: form.email, phone: form.phone.trim() || null, currentPassword: form.currentPassword || undefined } }),
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
    if (form.email.trim().toLowerCase() !== data?.email && !form.currentPassword) return setProblem('Enter your current password to change your email')
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
          <Avatar name={data.fullName} url={data.avatarUrl} className="size-20 text-3xl" />
          <div className="min-w-0">
            <h2 className="display truncate text-2xl">{data.fullName}</h2>
            <div className="mt-1.5">
              <Badge kind={verified ? 'good' : 'warn'}>{verified ? <BadgeCheck size={13} /> : <ShieldAlert size={13} />}{verified ? 'Verified' : 'Not verified'}</Badge>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload a profile picture" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) saveAvatar.mutate(f) }} />
          <Button type="button" variant="soft" className="min-h-11" loading={saveAvatar.isPending} onClick={() => fileInput.current?.click()}><Camera size={16} /> {data.avatarUrl ? 'Change picture' : 'Upload picture'}</Button>
          {data.avatarUrl && <Button type="button" variant="ghost" className="min-h-11" loading={removeAvatar.isPending} onClick={() => removeAvatar.mutate()}><Trash2 size={16} /> Remove</Button>}
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
            <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} hint="This is also the email you sign in with. Changing it needs your current password." required />
            {form.email.trim().toLowerCase() !== data.email && (
              <Field label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} maxLength={200} required />
            )}
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
