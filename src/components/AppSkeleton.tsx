import { Skeleton } from './ui'

/** Page-shaped placeholder shown while the app loads and while the session is checked, so nothing jumps when the real screen arrives. */
export function AppSkeleton() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]" role="status" aria-busy="true" aria-label="Loading NairaBridge">
      <aside className="sticky top-0 hidden h-dvh p-5 lg:block">
        <div className="glass flex h-full flex-col gap-3 rounded-3xl p-4">
          <Skeleton className="h-10 w-40 !rounded-xl" />
          <div className="mt-4 space-y-2">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-11 w-full !rounded-full" />)}</div>
        </div>
      </aside>
      <div className="min-w-0 px-4 py-4 pb-32 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-10 w-36 !rounded-xl lg:hidden" />
            <div className="ml-auto flex gap-2"><Skeleton className="size-11 !rounded-full" /><Skeleton className="size-11 !rounded-full" /></div>
          </div>
          <Skeleton className="h-44 w-full !rounded-3xl" />
          <div className="grid grid-cols-4 gap-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20 !rounded-2xl" />)}</div>
          <Skeleton className="h-56 w-full !rounded-3xl" />
        </div>
      </div>
      <nav className="sticker fixed inset-x-1.5 bottom-3 z-30 mx-auto grid max-w-md grid-cols-5 gap-1 rounded-full p-2 lg:hidden" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 !rounded-full" />)}
      </nav>
    </div>
  )
}
