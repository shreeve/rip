import { defineConfig, devices } from '@playwright/test';

const cartUrl = process.env.CART_HARNESS_URL || 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  webServer: [
    {
      command: 'bun --preload=../../src/loader.js serve.mjs',
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'bun cart-harness.mjs',
      url: `${cartUrl}/__test/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: {
        ...process.env,
        CART_HARNESS_PORT: '4174',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /cart-apply/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'firefox',
      testIgnore: /cart-apply/,
      use: { ...devices['Desktop Firefox'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'webkit',
      testIgnore: /cart-apply/,
      use: { ...devices['Desktop Safari'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      // Cart publication apply is chromium-first: real Rip Server. Expand
      // to firefox/webkit once the harness is sticky in CI.
      name: 'cart-chromium',
      testMatch: /cart-apply/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: cartUrl,
      },
    },
  ],
});
