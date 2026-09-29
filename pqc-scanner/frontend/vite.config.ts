import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Two UI variants share one codebase:
//   default  → dist/      (dev on :5180)
//   --mode hud → dist-hud/  the Stark-HUD dashboard (dev on :5182)
// In dev, /api is proxied to the local FastAPI scanner. In production set VITE_API_URL.
export default defineConfig(({ mode }) => {
  const hud = mode === 'hud'
  return {
    plugins: [react(), tailwindcss()],
    define: { 'import.meta.env.VITE_UI': JSON.stringify(hud ? 'hud' : 'default') },
    server: {
      port: hud ? 5182 : 5180,
      proxy: { '/api': { target: 'http://127.0.0.1:8010', changeOrigin: true } },
    },
    build: { outDir: hud ? 'dist-hud' : 'dist', chunkSizeWarningLimit: 2000 },
  }
})
