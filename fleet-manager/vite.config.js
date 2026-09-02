import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Government Fleet Manager portal (issue #65). Runs alongside web/ on its own
// port so both dashboards can be open at once during a demo.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Same-origin proxy as web/, so no CORS configuration is needed in dev and
    // the portal does not have to know the backend's port.
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
