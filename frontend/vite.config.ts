import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev, /api is proxied to the FastAPI server. In production both are
// served from the same origin by Uvicorn, so the paths stay relative.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  build: {
    // FastAPI serves this folder at "/" (see backend/app/frontend.py).
    outDir: path.resolve(import.meta.dirname, '../backend/static'),
    emptyOutDir: true,
    // The lazily loaded three.js chunk is ~1 MB (270 KB gzipped) by design.
    chunkSizeWarningLimit: 1100,
  },
  server: {
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
