import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from './api'
import { useSession } from './session'
import { DEFAULT_TEXT_SIZE, isTextSizeId, type TextSizeId } from './textSizeIds'
import { applyTextSize, getTextSize, localTextSize, rememberTextSize, stepTextSize, type TextSizeDef } from './textSizes'

interface Ctx {
  sizeId: TextSizeId
  size: TextSizeDef
  /** Changes the text size everywhere at once, then saves it to the account. A failed save keeps the new size on screen. */
  setSize: (id: TextSizeId) => void
  step: (dir: -1 | 1) => void
  reset: () => void
  saving: boolean
}
const TextSizeCtx = createContext<Ctx | null>(null)

/** Same pattern as the theme: this device's copy first, then the account's copy once the server answers. */
export function TextSizeProvider({ children }: { children: ReactNode }) {
  const { user } = useSession()
  const [sizeId, setSizeId] = useState<TextSizeId>(localTextSize)
  const [saving, setSaving] = useState(false)
  const picked = useRef(false)

  useEffect(() => {
    applyTextSize(sizeId)
    rememberTextSize(sizeId)
  }, [sizeId])

  const { data } = useQuery({
    queryKey: ['text-size', user?.id],
    enabled: Boolean(user),
    queryFn: () => api<{ textScale: string }>('/api/settings/text-size'),
    staleTime: Infinity,
    retry: 1,
  })
  useEffect(() => {
    if (data && !picked.current && isTextSizeId(data.textScale)) setSizeId(data.textScale)
  }, [data])
  useEffect(() => {
    picked.current = false
  }, [user?.id])

  const setSize = useCallback((id: TextSizeId) => {
    picked.current = true
    setSizeId(id)
    applyTextSize(id)
    rememberTextSize(id)
    setSaving(true)
    api('/api/settings/text-size', { method: 'PUT', body: { textScale: id } })
      .catch((e: unknown) => toast.error(`Text size applied here, but not saved to your account: ${e instanceof Error ? e.message : 'request failed'}`))
      .finally(() => setSaving(false))
  }, [])

  const value = useMemo<Ctx>(
    () => ({
      sizeId, size: getTextSize(sizeId), setSize, saving,
      step: (dir) => setSize(stepTextSize(sizeId, dir)),
      reset: () => setSize(DEFAULT_TEXT_SIZE),
    }),
    [sizeId, setSize, saving],
  )
  return <TextSizeCtx.Provider value={value}>{children}</TextSizeCtx.Provider>
}

export function useTextSize() {
  const c = useContext(TextSizeCtx)
  if (!c) throw new Error('useTextSize must be used inside TextSizeProvider')
  return c
}
