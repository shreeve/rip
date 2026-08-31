import { defineConfig, devices } from '@playwright/test';

// Two suites, selected by RIP_SUITE:
//
//   smoke  fixture pages served by serve.mjs — Stage C surface, cross-browser
//   live   a real `rip site` behind a stub Janus edge (site-harness.mjs),
//          serving test/browser/hmr-app: the HMR refresh tiers and API
//          proxying
//
// The subject is always a fixture this suite owns. No demo is a gate — see
// test/browser/hmr-app/README.md.
const suite = process.env.RIP_SUITE || 'smoke';

const smokeServers = [{
  command: 'bun --preload=../../src/loader.js serve.mjs',
  port: 4173,
  reuseExistingServer: !process.env.CI,
}];

const smokeProjects = ['chromium', 'firefox', 'webkit'].map((name) => ({
  name,
  testMatch: /(app|workspace)\.spec\.mjs$/,
  use: {
    ...devices[name === 'chromium' ? 'Desktop Chrome' : name === 'firefox' ? 'Desktop Firefox' : 'Desktop Safari'],
    baseURL: 'http://127.0.0.1:4173',
  },
}));

// A real Rip Site on `port`, serving `app`, for the specs matching `testMatch`.
const site = ({ app, port, testMatch, name }) => ({
  servers: [{
    command: 'bun site-harness.mjs',
    url: `http://127.0.0.1:${port}/__test/ready`,
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
    env: { ...process.env, RIP_HARNESS_APP: app, RIP_HARNESS_PORT: String(port) },
  }],
  // Chromium-first: these drive a real Site, and the tier seam is one runtime.
  projects: [{
    name,
    testMatch,
    use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${port}` },
  }],
});

const live = site({
  name: 'live-chromium',
  app: 'test/browser/hmr-app',
  port: 4175,
  testMatch: /live-.*\.spec\.mjs$/,
});

const selected = suite === 'live' ? live : { servers: smokeServers, projects: smokeProjects };

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  webServer: selected.servers,
  projects: selected.projects,
});
