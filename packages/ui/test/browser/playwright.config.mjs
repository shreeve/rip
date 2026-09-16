import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// RIP_UI_URL names a running instance to drive (the Sites-served demo,
// https://ui.local/); without it the specs start their own server.
const live = process.env.RIP_UI_URL
const port = 4180
const pkg = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  webServer: live ? undefined : {
    command: 'bun ../../bin/rip test/browser/serve.rip',
    cwd: pkg,
    port,
    reuseExistingServer: !process.env.CI,
  },
  projects: ['chromium', 'firefox', 'webkit'].map((name) => ({
    name,
    use: {
      ...devices[name === 'chromium' ? 'Desktop Chrome' : name === 'firefox' ? 'Desktop Firefox' : 'Desktop Safari'],
      baseURL: live ?? `http://127.0.0.1:${port}`,
      ignoreHTTPSErrors: Boolean(live),
    },
  })),
})
