import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, FlaskConical, ShieldCheck, Zap } from 'lucide-react'
import { api, type PublicUser } from '@/lib/api'
import { useSession } from '@/lib/session'
import { Button, Card, Field, Sandbox, Segmented } from './ui'

type AuthResult = { token: string; user: PublicUser }

export function AuthScreen() {
  const { signIn, config } = useSession()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')

  const dev = useMutation({
    mutationFn: (role: 'user' | 'founder') => api<AuthResult>('/api/auth/dev-session', { method: 'POST', body: { role } }),
    onSuccess: (r) => signIn(r.token, r.user),
  })
  const auth = useMutation({
    mutationFn: () => api<AuthResult>(`/api/auth/${mode}`, { method: 'POST', body: mode === 'login' ? { email, password } : { email, name, password } }),
    onSuccess: (r) => signIn(r.token, r.user),
  })

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
      <section>
        <div className="display plate text-xl">NairaBridge</div>
        <h1 className="display mt-6 text-balance text-5xl leading-[1.02] sm:text-6xl">
          <span className="plate !block !rounded-3xl !px-5 !py-3">Crypto to Naira, without the P2P wait.</span>
        </h1>
        <p className="plate-sub mt-6 max-w-md !rounded-3xl !px-4 !py-3 text-pretty text-sm font-semibold">
          A transaction agent watches the chain, verifies every token, and pays out as soon as the evidence checks out. Final settlement is always confirmed afterwards.
        </p>
        <ul className="mt-6 flex flex-wrap gap-3 text-sm font-extrabold">
          <li className="plate-sub flex items-center gap-2"><Zap size={18} /> Detects deposits seconds after broadcast</li>
          <li className="plate-sub flex items-center gap-2"><ShieldCheck size={18} /> Fake tokens are rejected, never credited</li>
        </ul>
      </section>

      <div className="space-y-4">
        {config?.devPreview && (
          <Card strong className="p-5">
            <div className="flex items-center gap-2">
              <FlaskConical size={18} />
              <h2 className="display text-xl">Development preview</h2>
              <Sandbox />
            </div>
            <p className="mt-2 text-pretty text-sm font-medium text-subtle">
              Skip login and explore with sandbox money. Nothing here moves real funds. This entry is switched off before any real-money launch.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Button onClick={() => dev.mutate('user')} loading={dev.isPending && dev.variables === 'user'}>
                Enter as customer <ArrowRight size={16} />
              </Button>
              <Button variant="ghost" onClick={() => dev.mutate('founder')} loading={dev.isPending && dev.variables === 'founder'}>
                Enter as founder
              </Button>
            </div>
            {dev.error && <p role="alert" className="mt-3 rounded-2xl border-2 border-outline bg-danger px-3 py-2 text-sm font-bold text-on-danger">{dev.error.message}</p>}
          </Card>
        )}

        <Card className="p-5">
          <Segmented value={mode} onChange={setMode} options={[{ value: 'login', label: 'Sign in' }, { value: 'register', label: 'Create account' }]} />
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              auth.mutate()
            }}
          >
            {mode === 'register' && <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />}
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} hint={mode === 'register' ? 'At least 10 characters' : undefined} required />
            {auth.error && <p role="alert" className="rounded-2xl border-2 border-outline bg-danger px-3 py-2 text-sm font-bold text-on-danger">{auth.error.message}</p>}
            <Button type="submit" className="w-full" loading={auth.isPending}>{mode === 'login' ? 'Sign in' : 'Create account'}</Button>
          </form>
        </Card>
      </div>
    </main>
  )
}
