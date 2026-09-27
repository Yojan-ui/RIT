import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The browser only ever talks to /api on its own origin. In development Vite proxies that to the
// FastAPI backend, so there is no CORS to configure; in production FastAPI serves the built app,
// or VITE_API_BASE_URL points the client at a separately hosted backend.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.SMS_BACKEND_URL || 'http://127.0.0.1:8000'
  const proxy = { '/api': { target: backend, changeOrigin: false } }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
    build: {
      target: 'es2023',
      sourcemap: true,
      // The 3D view's chunk is mostly three.js (~900 kB). It is lazy-loaded after first paint, so
      // it never delays the terminal; the main bundle stays around 260 kB.
      chunkSizeWarningLimit: 1000,
    },
  }
})
