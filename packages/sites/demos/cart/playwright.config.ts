import { defineConfig } from '@playwright/test'

export default defineConfig({
  workers: 1,
  testDir: './test/.build/test',
  globalSetup: './test/.build/test/support/setup.js',
  use: {
    baseURL: 'https://cart.via.rip',
    ignoreHTTPSErrors: true,
  },
})
