import { defineConfig } from '@playwright/test'

export default defineConfig({
  workers: 1,
  globalSetup: './test/support/setup.ts',
  use: {
    baseURL: 'https://cart.via.rip',
    ignoreHTTPSErrors: true,
  },
})
