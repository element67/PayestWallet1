/** "About 1 minute", "About 15 minutes". Null when the provider did not say. */
export function eta(seconds: number | null): string {
  if (seconds === null) return 'Not stated'
  if (seconds < 60) return `About ${Math.max(seconds, 5)} seconds`
  const m = Math.round(seconds / 60)
  return `About ${m} minute${m === 1 ? '' : 's'}`
}
