import { defineConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// RIP_UI_URL names a running instance to drive (the Sites-served demo,
// https://ui.local/); without it the specs start their own server.
const live = process.env.RIP_UI_URL
const port = 4180

// Firefox is not installed on every developer's machine, so it joins
// under RIP_FIREFOX, which certification sets.
const browsers = ['chromium', 'webkit', ...(process.env.RIP_FIREFOX ? ['firefox'] : [])]

export default defineConfig({
  outputDir: 'test-results',
  webServer: live ? undefined : {
    command: 'bun ../../bin/rip test/browser/serve.rip',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    port,
  },
  use: { baseURL: live ?? `http://127.0.0.1:${port}`, ignoreHTTPSErrors: Boolean(live) },
  projects: browsers.map((browserName) => ({ name: browserName, use: { browserName, launchOptions: launchOptions(browserName) } })),
})

// Playwright's Firefox reads the installed Firefox's app-data folder at
// startup even with its own profile, and macOS 27 keeps that folder behind
// Full Disk Access, which a process started from a terminal or an editor
// rarely has: the launch hangs on the read. A scratch home moves
// CoreFoundation's app-data lookup into a folder the run owns.
// https://github.com/microsoft/playwright/issues/42768
function launchOptions(browserName) {
  if (browserName !== 'firefox' || process.platform !== 'darwin') return {}
  const home = join(tmpdir(), 'rip-ui-firefox-home')
  mkdirSync(home, { recursive: true })
  return { env: { ...process.env, CFFIXED_USER_HOME: home } }
}
