'use client'

/*
 * Client root of the admin dashboard. It has its own providers and its own layout (src/admin/AdminApp.tsx), separate from the
 * customer app: no wallet connection, no customer navigation. It loads in the browser only (see src/app/admin).
 */

import '@/tracing'
import '@/console-capture'

import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { SessionProvider } from '@/lib/session'
import { ThemeProvider } from '@/lib/theme'
import { TextSizeProvider } from '@/lib/textSize'
import { applyTheme, localTheme } from '@/lib/themes'
import { applyTextSize, localTextSize } from '@/lib/textSizes'
import AdminApp from './AdminApp'

const queryClient = new QueryClient()
applyTheme(localTheme())
applyTextSize(localTextSize())

export default function AdminRoot() {
  return (
    <StrictMode>
      <div id="root">
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <ThemeProvider>
              <TextSizeProvider>
                <AdminApp />
                <Toaster position="top-center" toastOptions={{ unstyled: true, classNames: { toast: 'sticker flex w-full items-center gap-3 rounded-2xl p-4 text-sm font-bold', error: '!bg-danger !text-on-danger' } }} />
              </TextSizeProvider>
            </ThemeProvider>
          </SessionProvider>
        </QueryClientProvider>
      </div>
    </StrictMode>
  )
}
