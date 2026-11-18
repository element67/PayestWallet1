import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyTheme, localMode, rememberMode } from './themes'
import type { Mode } from './themeIds'

interface Ctx {
  mode: Mode
  /** Switches between Light and Dark. The choice is remembered on this device. */
  setMode: (mode: Mode) => void
  toggleMode: () => void
}
const ThemeCtx = createContext<Ctx | null>(null)

/** The saved mode is applied from this device's copy straight away (AppFrame); this keeps it in step when the user switches. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(localMode)

  useEffect(() => {
    applyTheme(mode)
    rememberMode(mode)
  }, [mode])

  const setMode = useCallback((m: Mode) => setModeState(m), [])
  const toggleMode = useCallback(() => setModeState((m) => (m === 'dark' ? 'light' : 'dark')), [])

  const value = useMemo<Ctx>(() => ({ mode, setMode, toggleMode }), [mode, setMode, toggleMode])
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  const c = useContext(ThemeCtx)
  if (!c) throw new Error('useTheme must be used inside ThemeProvider')
  return c
}
