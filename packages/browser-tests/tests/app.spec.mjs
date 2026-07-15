// Real-browser certification of the Stage C surface: boot through the
// entry, navigation, render gates, script tags, and mapped
// diagnostics — the contracts the Node suites pinned, alive in a page.
import { expect, test } from '@playwright/test';

test('boots, renders the route, and a plain link click is an SPA navigation', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');
  await expect(page.locator('#title')).toHaveText('home');

  // A sentinel on window survives the navigation only if the click was
  // intercepted — a full page load would wipe it.
  await page.evaluate(() => { globalThis.__spaSentinel = 'alive'; });
  await page.click('a[href="/profile"]');
  await expect(page.locator('#title')).toHaveText('Ada Lovelace');
  expect(await page.evaluate(() => location.pathname)).toBe('/profile');
  expect(await page.evaluate(() => globalThis.__spaSentinel)).toBe('alive');
});

test('programmatic push and back drive navigation with render gates', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');
  await expect(page.locator('#title')).toHaveText('home');

  await page.evaluate(() => globalThis.__rip.router.push('/profile'));
  await expect(page.locator('#title')).toHaveText('Ada Lovelace');

  await page.evaluate(() => globalThis.__rip.router.back());
  await expect(page.locator('#title')).toHaveText('home');
});

test('a reload revalidates the bundle through its ETag', async ({ page }) => {
  const statuses = [];
  page.on('response', response => {
    if (response.url().endsWith('/bundle.json')) statuses.push(response.status());
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');
  await page.reload();
  await expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');
  expect(statuses[0]).toBe(200);
  expect(statuses[1]).toBe(304);
});

test('source maps ship only when the page opts into debug', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'script-parse metadata arrives over CDP');
  const client = await page.context().newCDPSession(page);
  await client.send('Debugger.enable');
  const mapped = new Set();
  client.on('Debugger.scriptParsed', event => {
    if (event.sourceMapURL) mapped.add(event.url);
  });

  await page.goto('/');
  await expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');
  expect([...mapped].filter(url => url.startsWith('blob:'))).toEqual([]);

  await page.goto('/?debug=1');
  await expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');
  expect([...mapped].filter(url => url.startsWith('blob:')).length).toBeGreaterThan(0);
});

test('script tags share one scope and report mapped diagnostics', async ({ page }) => {
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/scripts.html');
  await expect(page.locator('#out')).toHaveText('value: 42');
  await expect.poll(() => errors.join('\n')).toContain('<script:3>');
});
