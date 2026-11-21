import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 's1.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 420_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4177',
    viewport: { width: 1280, height: 800 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command:
      'pnpm exec vite --config spikes/s1-github-git-data/vite.config.ts --port 4177 --strictPort',
    cwd: path.resolve(import.meta.dirname, '../..'),
    url: 'http://127.0.0.1:4177',
    reuseExistingServer: false,
  },
})
