import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// RIP_UI_URL names a running instance to drive (the Sites-served demo,
// https://ui.local/); without it the specs start their own server.
const live = process.env.RIP_UI_URL
const port = 4180

export default defineConfig({
  outputDir: 'test-results',
  webServer: live ? undefined : {
    command: 'bun ../../bin/rip test/browser/serve.rip',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    port,
  },
  use: { baseURL: live ?? `http://127.0.0.1:${port}`, ignoreHTTPSErrors: Boolean(live) },
  projects: ['chromium', 'webkit'].map((browserName) => ({ name: browserName, use: { browserName } })),
})
