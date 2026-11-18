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
        {/* Sets Light or Dark before the first paint, so a dark-mode user never sees a white flash. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var m=localStorage.getItem('nb_theme_mode');if(m!=='light'&&m!=='dark')m='light';document.documentElement.dataset.mode=m;document.documentElement.style.colorScheme=m}catch(e){}" }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&family=JetBrains+Mono:wght@500;600&display=swap" />
      </head>
      <body suppressHydrationWarning>
        {/* Built with Arc Studio: https://studio.arc.io */}
        {children}
      </body>
    </html>
  )
}
