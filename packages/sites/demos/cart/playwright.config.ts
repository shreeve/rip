import { defineConfig } from '@playwright/test'

if (!process.env.CART_RIP_RUNNER) throw new Error('the cart specs compile through the runner — run: bun run test')

export default defineConfig({
  workers: 1,
  testDir: './test/.build/test',
  globalSetup: './test/.build/test/support/setup.js',
  use: {
    baseURL: 'https://cart.via.rip',
    ignoreHTTPSErrors: true,
  },
})
