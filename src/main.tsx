/*
 *  ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗
 *  ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
 *  ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
 *  ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝
 *
 *  Built with Arc Studio
 *  https://studio.arc.io
 */

import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { Toaster } from 'sonner'
import { config } from './config'
import App from './App'
import { installShareSync } from './lib/share'
import './index.css'
import { applyTheme, localTheme } from './lib/themes'
import { applyTextSize, localTextSize } from './lib/textSizes'

const queryClient = new QueryClient()

// The wallet-connect popup reads the same theme tokens as the rest of the app.
const connectTheme = {
  '--ck-font-family': '"DM Sans", sans-serif',
  '--ck-border-radius': '24px',
  '--ck-overlay-background': 'color-mix(in srgb, var(--outline) 72%, transparent)',
  '--ck-overlay-backdrop-filter': 'none',
  '--ck-body-background': 'var(--card)',
  '--ck-body-background-secondary': 'var(--card-muted)',
  '--ck-body-background-secondary-hover-background': 'var(--card-strong)',
  '--ck-body-background-tertiary': 'var(--card-muted)',
  '--ck-body-color': 'var(--card-ink)',
  '--ck-body-color-muted': 'var(--card-subtle)',
  '--ck-body-color-muted-hover': 'var(--card-ink)',
  '--ck-body-divider': 'var(--card-divider)',
  '--ck-primary-button-background': 'var(--card-muted)',
  '--ck-primary-button-hover-background': 'var(--card-strong)',
  '--ck-secondary-button-background': 'var(--card-muted)',
  '--ck-secondary-button-hover-background': 'var(--card-strong)',
  '--ck-focus-color': 'var(--accent)',
  '--ck-modal-box-shadow': '0 0 0 3px var(--outline), 7px 7px 0 3px var(--shadow-c)',
  '--ck-primary-button-box-shadow': '0 0 0 2px var(--outline)',
  '--ck-secondary-button-box-shadow': '0 0 0 2px var(--outline)',
} as Record<string, string>

// Studio logo SVG
const StudioLogo = () => (
  <svg width="14" height="16" viewBox="0 0 20 22" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 21.5001C0.167192 16.2366 1.02308 11.3243 2.45378 7.50459C4.26573 2.66517 6.88869 0 9.83904 0C12.7894 0 15.412 2.66517 17.2243 7.50459C18.1669 10.0216 18.8605 13.0121 19.2713 16.2655C19.3081 16.556 19.3393 16.8513 19.3714 17.146C19.3819 17.1642 19.3881 17.1811 19.386 17.1949C19.386 17.1949 19.6275 18.7674 19.6788 21.5001H19.6515C19.2934 21.1937 15.0694 17.7329 8.06739 18.735C8.17304 17.4996 8.31833 16.2974 8.50603 15.1452C8.51562 15.0863 8.52671 15.0294 8.53649 14.9709C11.2828 14.8846 13.6866 15.2171 15.5299 15.6529C15.5231 15.6073 15.5173 15.5603 15.5103 15.5149C15.1314 13.0547 14.5724 10.8024 13.8517 8.87761C12.6732 5.73037 11.1354 3.77496 9.83904 3.77496C8.54269 3.77496 7.00493 5.73037 5.82649 8.87761C5.54123 9.63889 5.28154 10.4508 5.04866 11.3071C4.72126 12.507 4.44621 13.7934 4.22654 15.1451C3.90141 17.1412 3.69827 19.2821 3.62345 21.5001H0Z" fill="currentColor"/>
  </svg>
)

// Studio watermark component - links back to Studio. Styled by the theme (see .studio-badge in index.css).
const StudioWatermark = () => (
  <a href="https://studio.arc.io/" target="_blank" rel="noopener noreferrer" className="studio-badge">
    <StudioLogo />
    Built with Arc Studio
  </a>
)

// The saved theme is applied before the first paint, so there is no flash of the wrong colours.
applyTheme(localTheme())
applyTextSize(localTextSize())
installShareSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider customTheme={connectTheme}>
          <App />
          <StudioWatermark />
          <Toaster
            position="top-center"
            toastOptions={{
              unstyled: true,
              classNames: {
                toast: 'sticker flex w-full items-center gap-3 rounded-2xl p-4 text-sm font-bold',
                title: 'font-extrabold',
                description: 'text-xs font-medium',
                error: '!bg-danger !text-on-danger',
                success: '',
                actionButton: 'rounded-full border-2 border-outline bg-accent px-3 py-1 text-accent-ink',
                cancelButton: 'rounded-full border-2 border-outline bg-muted px-3 py-1 text-ink',
              },
            }}
          />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

