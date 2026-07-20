import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file from backend directory since that's where FRONTEND_URL is defined
  const env = loadEnv(mode, '../backend', '')

  // Parse the hostname from FRONTEND_URL if it exists
  let allowedHosts = ['localhost', '127.0.0.1', 'briankwest.ngrok.io']
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
    optimizeDeps: {
      // @signalwire/js is now the published npm package (4.0.0-rc.0), not a
      // local alias. Pre-bundle it and rxjs so Vite resolves their ESM cleanly.
      include: ['@signalwire/js', 'rxjs']
    },
    server: {
      port: 5173,
      host: true, // Listen on all addresses
      allowedHosts, // Allow the ngrok domain
      proxy: {
        '/api': {
          target: 'http://localhost:5001',
          changeOrigin: true,
        },
      },
    },
  }
})