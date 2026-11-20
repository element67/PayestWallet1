import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, type PublicUser } from '@/lib/api'
import { useSession } from '@/lib/session'
import { Button, Card, Field, Segmented } from './ui'

type AuthResult = { token: string; user: PublicUser }

export function AuthScreen() {
  const { signIn } = useSession()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')

  const auth = useMutation({
    mutationFn: () => api<AuthResult>(`/api/auth/${mode}`, { method: 'POST', body: mode === 'login' ? { email, password } : { email, name, password } }),
    onSuccess: (r) => signIn(r.token, r.user),
  })

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-5 py-8">
      <section>
        <div className="display plate text-xl">Payest Wallet</div>
        <h1 className="display mt-5 text-balance text-5xl leading-[1.02] sm:text-6xl">
          <span className="plate !block !rounded-3xl !px-5 !py-3">Crypto to Naira, without the P2P wait.</span>
        </h1>
        <p className="plate-sub mt-4 max-w-md !rounded-3xl !px-4 !py-3 text-pretty text-sm font-semibold">
          Send money, swap Naira to crypto, and crypto to Naira, as easily as sending a text.
        </p>
      </section>

      <div>
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
            {mode === 'login'
              ? <Field label="Email or username" type="text" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="none" required />
              : <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}
            <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} hint={mode === 'register' ? 'At least 10 characters' : undefined} required />
            {auth.error && <p role="alert" className="rounded-2xl border-2 border-outline bg-danger px-3 py-2 text-sm font-bold text-on-danger">{auth.error.message}</p>}
            <Button type="submit" className="w-full" loading={auth.isPending}>{mode === 'login' ? 'Sign in' : 'Create account'}</Button>
          </form>
        </Card>
      </div>
    </main>
  )
}
