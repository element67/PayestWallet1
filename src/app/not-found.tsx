import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-5 text-center">
      <div className="space-y-4">
        <h1 className="display text-3xl">Page not found</h1>
        <p className="text-sm text-subtle">That address does not lead anywhere in NairaBridge.</p>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-full border-2 border-outline bg-accent px-5 text-sm font-extrabold text-accent-ink">Back to Home</Link>
      </div>
    </main>
  )
}
