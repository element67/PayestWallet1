import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import '../index.css'

export const metadata: Metadata = {
  title: 'NairaBridge | Crypto to Naira, instantly',
  generator: 'Arc Studio by Circle (https://studio.arc.io)',
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@800&display=swap" />
      </head>
      <body suppressHydrationWarning>
        {/* Built with Arc Studio: https://studio.arc.io */}
        {children}
      </body>
    </html>
  )
}
