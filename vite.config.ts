import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // Pre-bundle lazy canvas dependencies in dev mode so navigating to #/n/:id
  // never triggers mid-session 504 Outdated Optimize Dep reloads.
  optimizeDeps: {
    include: [
      '@xyflow/react',
      '@tiptap/core',
      '@tiptap/static-renderer/pm/react',
      '@tiptap/starter-kit',
      '@tiptap/extension-underline',
      '@tiptap/extension-link',
      '@tiptap/extension-text-style',
      '@tiptap/extension-text-align',
      '@tiptap/extension-highlight',
    ],
  },
})
