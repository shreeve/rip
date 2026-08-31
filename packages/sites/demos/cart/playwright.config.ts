import { defineConfig } from '@playwright/test'

export default defineConfig({
  workers: 1,
  globalSetup: './test/support/setup.ts',
  use: {
    baseURL: process.env.CART_URL || 'https://cart.via.rip',
    ignoreHTTPSErrors: true,
  },
})
