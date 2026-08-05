// The Workspace publication path in a real page: the
// page boots under watch mode, the harness publishes one module change
// the hub, and the DOM visibly updates without a navigation or a
// reload. Changed Rip source rides in the watch message; ordinary assets do not.
import { expect, test } from '@playwright/test';

const HARNESS = 'http://localhost:4173';

test('a source-carrying Rip change visibly updates without reload', async ({ page }) => {
  await page.goto('/workspace.html');
  await expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');
  await expect(page.locator('#title')).toBeVisible();

  // A full page load would wipe the sentinel; a valid Rip update must not.
  await page.evaluate(() => { globalThis.__wsSentinel = 'alive'; });
  const stamp = `door ${Date.now()} ${Math.random().toString(36).slice(2)}`;
  const bumped = await fetch(`${HARNESS}/__test/bump`, {
    method: 'POST',
    body: JSON.stringify({ id: 'routes/index.rip', title: stamp }),
  });
  expect(bumped.ok).toBe(true);

  await page.waitForFunction(
    expected => document.querySelector('#title')?.textContent === expected,
    stamp,
  );
  expect(await page.evaluate(() => location.pathname)).toBe('/workspace.html');
  expect(await page.evaluate(() => globalThis.__wsSentinel)).toBe('alive');

  // The one WSS frame is an ordered from → hash transition with Rip source.
  const frames = await (await fetch(`${HARNESS}/__test/frames`)).json();
  expect(frames.length).toBeGreaterThan(0);
  let matching = null;
  for (const frame of frames) {
    const parsed = JSON.parse(frame);
    expect(Object.keys(parsed)).toEqual(['change']);
    expect(Object.keys(parsed.change).sort()).toEqual(['from', 'hash', 'list']);
    expect(parsed.change.list[0][0]).toBe('routes/index.rip');
    if (parsed.change.list[0][1].includes(stamp)) matching = parsed;
  }
  expect(matching).not.toBeNull();
});
