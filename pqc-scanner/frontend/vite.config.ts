import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev, /api is proxied to the local FastAPI scanner. In production set VITE_API_URL.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: { '/api': { target: 'http://127.0.0.1:8010', changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 2000 },
})
