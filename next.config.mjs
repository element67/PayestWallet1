const UNUSED_WALLET_SDKS = [
  '@base-org/account',
  '@coinbase/wallet-sdk',
  'cbw-sdk',
  '@metamask/sdk',
  'porto',
  '@safe-global/safe-apps-provider',
  '@safe-global/safe-apps-sdk',
  '@walletconnect/ethereum-provider',
  '@x402/evm',
]

const isProd = process.env.NODE_ENV === 'production'

/**
 * Who may show this app inside a frame. Everyone else is refused, which stops click-jacking (another site putting an invisible
 * copy of the app over its own buttons). The Arc Studio preview is a frame, so *.arc.io is allowed; add your own hosts with
 * FRAME_ANCESTORS (comma separated, for example https://app.example.com).
 */
const frameAncestors = ["'self'", 'https://*.arc.io', 'https://arc.io', ...(process.env.FRAME_ANCESTORS ?? '').split(',').map((h) => h.trim()).filter(Boolean)]

/**
 * Content Security Policy: the browser only runs scripts, styles, fonts and images from the places listed here, and only talks to
 * HTTPS or secure WebSocket addresses. Next.js and the early light/dark script write small inline scripts, so inline scripts are
 * allowed, but eval, plugins (object), other sites' frames and foreign form targets are not. Only sent in production: the
 * development server needs eval for hot reload.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  `frame-ancestors ${frameAncestors.join(' ')}`,
].join('; ')

const securityHeaders = [
  ...(isProd ? [
    { key: 'Content-Security-Policy', value: csp },
    // Browsers only honour this over HTTPS: after the first visit they refuse to open the site over plain HTTP for a year.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  ] : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The camera is needed only by this app's own QR scanner. Everything else the app never uses is switched off.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Type checking is its own step (`bun run typecheck`, part of `bun run check`). Running it again inside the build needs more memory than small machines have.
  typescript: { ignoreBuildErrors: true },
  experimental: { webpackMemoryOptimizations: true, optimizePackageImports: ['@web3icons/react', 'lucide-react', 'wagmi', 'viem', 'connectkit', 'framer-motion'] },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  // This project, not a lockfile found in a parent folder, is the root.
  outputFileTracingRoot: process.cwd(),
  // Dev only: hosts allowed to load the dev server's own assets (the Arc Studio preview is served from a generated host).
  allowedDevOrigins: ['*.preview.studio.arc.io', '*.studio.arc.io', ...(process.env.ALLOWED_DEV_ORIGINS ?? '').split(',').map((h) => h.trim()).filter(Boolean)],
  // Server-side packages that must load as plain Node modules rather than being bundled.
  serverExternalPackages: ['postgres', 'pino-pretty', '@circle-fin/app-kit', '@circle-fin/adapter-viem-v2', '@circle-fin/bridge-kit'],
  webpack: (config, { dev }) => {
    // Arc Studio rewrites traces.jsonl and console.jsonl in the project root, and the database and contract build
    // output change while the app runs. Watching them would recompile the app in a loop.
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next/**', '**/data/**', '**/contracts/**', '**/*.jsonl', '**/arc-studio-plans/**', '**/tests/**', '**/scripts/**', '**/supabase/**'],
      }
    }
    // Optional wallet-SDK peers that wagmi's connector barrel mentions but this app never uses.
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    // Only the browser-wallet (injected) connector is used. wagmi's connector barrel also reaches SDKs for other
    // wallets whose optional packages are not installed; they are never loaded at runtime, so they resolve to nothing.
    config.resolve.alias = { ...config.resolve.alias, ...Object.fromEntries(UNUSED_WALLET_SDKS.map((m) => [m, false])) }
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false }
    return config
  },
}

export default nextConfig
