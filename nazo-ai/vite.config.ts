import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // Dev-only: proxy the API (incl. SSE) to the live Spark backend so `npm run dev`
  // works against real data. No effect on the production build (same-origin there).
  server: {
    proxy: {
      '/api': {
        target: process.env.NAZO_API ?? 'http://192.168.1.155:8200',
        changeOrigin: true,
      },
    },
  },
})
