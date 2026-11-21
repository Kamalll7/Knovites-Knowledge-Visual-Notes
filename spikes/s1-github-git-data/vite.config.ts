import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  optimizeDeps: {
    include: ['octokit', 'react', 'react-dom/client'],
  },
  server: {
    host: '127.0.0.1',
    port: 4177,
    strictPort: true,
    hmr: false,
    watch: {
      ignored: ['**/test-results/**', '**/playwright-report/**'],
    },
  },
})
