import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 's2.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      'pnpm exec vite --config spikes/s2-tiptap-reactflow/vite.config.ts --port 4175 --strictPort',
    cwd: path.resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
})
