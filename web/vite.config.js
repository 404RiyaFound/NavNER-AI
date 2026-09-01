import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // maplibre-gl loads its tile-parsing web worker from a path relative to its
    // own entry. Vite's dep optimizer rewrites the entry into .vite/deps/ but
    // does not emit the sibling worker, so the request 404s and the map renders
    // a blank canvas with no error. Excluding it keeps the package served from
    // node_modules, where the relative worker path resolves.
    exclude: ['maplibre-gl'],
  },
  server: {
    // Proxy /api and WebSocket /ws requests to the FastAPI backend.
    // This means all requests from the browser stay on the same origin
    // (whatever port Vite picks), so CORS headers are never needed in dev.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
