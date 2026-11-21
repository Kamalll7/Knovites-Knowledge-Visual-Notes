import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '../../src'),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      '@xyflow/react',
      '@tiptap/core',
      '@tiptap/react',
      '@tiptap/starter-kit',
      '@tiptap/static-renderer/pm/react',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
    hmr: false,
    watch: {
      ignored: ['**/test-results/**', '**/playwright-report/**'],
    },
  },
})
