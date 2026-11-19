import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'capture.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm exec vite --config spikes/s3-radial/vite.config.ts --port 4174 --strictPort',
    cwd: path.resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
})
