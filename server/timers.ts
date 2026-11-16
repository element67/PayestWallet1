/** Safe timers for background work: errors are logged instead of becoming unhandled rejections, and a run never overlaps itself. */
export function every(label: string, ms: number, fn: () => Promise<void> | void) {
  let busy = false
  return setInterval(() => {
    if (busy) return
    busy = true
    Promise.resolve()
      .then(fn)
      .catch((e: unknown) => console.error(`[${label}]`, e))
      .finally(() => {
        busy = false
      })
  }, ms)
}

export function later(label: string, ms: number, fn: () => Promise<void> | void) {
  return setTimeout(() => {
    Promise.resolve()
      .then(fn)
      .catch((e: unknown) => console.error(`[${label}]`, e))
  }, ms)
}
