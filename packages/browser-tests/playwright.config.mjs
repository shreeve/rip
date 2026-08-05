import { defineConfig, devices } from '@playwright/test';

const cartUrl = process.env.CART_HARNESS_URL || 'http://127.0.0.1:4174';
const cartCertification = process.env.RIP_CART_CERTIFICATION === '1';

const smokeServers = [{
  command: 'bun --preload=../../src/loader.js serve.mjs',
  port: 4173,
  reuseExistingServer: !process.env.CI,
}];

const cartServers = [{
  command: 'bun cart-harness.mjs',
  url: `${cartUrl}/__test/ready`,
  reuseExistingServer: !process.env.CI,
  timeout: 90000,
  env: {
    ...process.env,
    CART_HARNESS_PORT: '4174',
  },
}];

const smokeProjects = [
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
];

const cartProjects = [{
  // Cart publication apply is chromium-first: real Rip Site.
  name: 'cart-chromium',
  testMatch: /cart-apply/,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: cartUrl,
  },
}];

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  webServer: cartCertification ? cartServers : smokeServers,
  projects: cartCertification ? cartProjects : smokeProjects,
});
