import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { spawn } from 'node:child_process'
import net from 'node:net'

// Starts the NairaBridge API (server/index.ts) alongside the dev server when it is not already running.
function apiServer() {
  return {
    name: 'nairabridge-api',
    configureServer(server: { httpServer: { once: (e: string, cb: () => void) => void } | null }) {
      const probe = net.connect(3001, '127.0.0.1')
      probe.once('connect', () => probe.destroy())
      probe.once('error', () => {
        const child = spawn('bun', ['server/index.ts'], { stdio: 'inherit' })
        server.httpServer?.once('close', () => child.kill())
        process.once('exit', () => child.kill())
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), nodePolyfills(), apiServer()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
})
