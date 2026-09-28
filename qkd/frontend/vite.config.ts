import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// /api is proxied to the FastAPI BB84 backend, so the browser never needs CORS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // three.js + postprocessing are most of the bundle; one chunk is fine for a local demo.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:8100', changeOrigin: true },
    },
  },
})
