import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file from backend directory since that's where FRONTEND_URL is defined
  const env = loadEnv(mode, '../backend', '')

  // Parse the hostname from FRONTEND_URL if it exists
  const allowedHosts = ['localhost', '127.0.0.1']
  if (env.FRONTEND_URL) {
    try {
      const url = new URL(env.FRONTEND_URL)
      allowedHosts.push(url.hostname)
      console.log('Adding allowed host:', url.hostname)
    } catch (e) {
      console.warn('Could not parse FRONTEND_URL:', env.FRONTEND_URL)
    }
  }

  return {
    plugins: [react()],
    build: {
      rolldownOptions: {
        output: {
          // One cacheable vendor chunk for the SDK and rxjs -- the bulk of the
          // bundle, and not lazy-loadable since startup needs it. Also keeps
          // the app chunk under Vite's size warning.
          codeSplitting: {
            groups: [{ name: 'vendor-signalwire', test: /node_modules[\\/](@signalwire|rxjs)[\\/]/ }],
          },
        },
      },
    },
    optimizeDeps: {
      // @signalwire/js is the published npm package, not a local alias.
      // Pre-bundle it and rxjs so Vite resolves their ESM cleanly.
      include: ['@signalwire/js', 'rxjs']
    },
    server: {
      port: 5173,
      host: true, // Listen on all addresses
      allowedHosts, // localhost plus FRONTEND_URL's host (e.g. an ngrok tunnel)
      proxy: {
        '/api': {
          target: 'http://localhost:5001',
          changeOrigin: true,
        },
      },
    },
  }
})