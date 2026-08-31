import { defineConfig } from '@playwright/test'

// testDir points at the compiled specs; test/run.mjs owns that
// directory — it compiles every test/**/*.rip there and then runs
// Playwright, so `bun run test` (or `bun test/run.mjs`) is the entry.
export default defineConfig({
  workers: 1,
  testDir: './test/.build',
  globalSetup: './test/.build/support/setup.js',
  use: {
    baseURL: 'https://cart.via.rip',
    ignoreHTTPSErrors: true,
  },
})
