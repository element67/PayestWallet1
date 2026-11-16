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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Type checking is its own step (`bun run typecheck`, part of `bun run check`). Running it again inside the build needs more memory than small machines have.
  typescript: { ignoreBuildErrors: true },
  experimental: { webpackMemoryOptimizations: true, optimizePackageImports: ['@web3icons/react', 'lucide-react', 'wagmi', 'viem', 'connectkit', 'framer-motion'] },
  poweredByHeader: false,
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
