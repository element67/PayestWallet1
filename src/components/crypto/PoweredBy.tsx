import { POWERED_BY, type PoweredProvider } from '@/lib/providers'

/** One logo at a common height. Provider names are for screen readers only. A provider on hold is grayscale at low opacity. */
function Logo({ p }: { p: PoweredProvider }) {
  const live = p.status === 'live'
  const same = p.logoLight === p.logoDark
  return (
    <li role="img" aria-label={live ? `${p.name}, live` : `${p.name}, on hold until mainnet`} className={`relative flex h-[22px] items-center ${live ? '' : 'opacity-40 grayscale'}`}>
      <img src={p.logoLight} alt={p.name} className={same ? 'h-[22px] w-auto' : 'block h-[22px] w-auto [html[data-mode=dark]_&]:hidden'} draggable={false} />
      {!same && <img src={p.logoDark} alt="" aria-hidden="true" className="hidden h-[22px] w-auto [html[data-mode=dark]_&]:block" draggable={false} />}
      {live && <span aria-hidden="true" className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-success" />}
    </li>
  )
}

/** A quiet "Powered by" row, logos only. Not tappable: no buttons, links or cards. */
export function PoweredBy({ providers = POWERED_BY }: { providers?: PoweredProvider[] }) {
  return (
    <section aria-label="Powered by" className="pointer-events-none select-none pb-1 pt-2">
      <p className="mb-2 text-center text-xs text-subtle">Powered by</p>
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 px-2">
        {providers.map((p) => <Logo key={p.id} p={p} />)}
      </ul>
    </section>
  )
}
