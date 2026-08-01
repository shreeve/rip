// The Workspace door in a real page (docs/WORKSPACE.md, Probe 0): the
// page boots under workspace mode, the harness bumps a module and dings
// the hub, and the DOM visibly updates without a navigation or a
// reload (D5) — while the socket only ever carried {ding: {id, hash}}
// envelopes, never source bytes (D2 / Q8).
import { expect, test } from '@playwright/test';

const HARNESS = 'http://localhost:4173';

test('a harness ding visibly updates the page without reload, and the hub never carries bodies', async ({ page }) => {
  await page.goto('/workspace.html');
  await expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');
  await expect(page.locator('#title')).toBeVisible();

  // A full page load would wipe the sentinel; the door must not reload.
  await page.evaluate(() => { globalThis.__wsSentinel = 'alive'; });
  const stamp = `door ${Date.now()} ${Math.random().toString(36).slice(2)}`;
  const bumped = await fetch(`${HARNESS}/__test/bump`, {
    method: 'POST',
    body: JSON.stringify({ id: 'app/routes/index.rip', title: stamp }),
  });
  expect(bumped.ok).toBe(true);

  await page.waitForFunction(
    expected => document.querySelector('#title')?.textContent === expected,
    stamp,
  );
  expect(await page.evaluate(() => location.pathname)).toBe('/workspace.html');
  expect(await page.evaluate(() => globalThis.__wsSentinel)).toBe('alive');

  // D2: every frame the hub ever sent is a bare {ding: {id, hash}}.
  const frames = await (await fetch(`${HARNESS}/__test/frames`)).json();
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    const parsed = JSON.parse(frame);
    expect(Object.keys(parsed)).toEqual(['ding']);
    expect(Object.keys(parsed.ding).sort()).toEqual(['hash', 'id']);
    expect(frame).not.toContain('component');
    expect(frame.includes(stamp)).toBe(false);
  }
});
