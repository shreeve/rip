// Cart exemplar through real Rip Site: disk edits under app/ and Workspace
// publication apply. Vue remount floor — layout +
// stash survive leaf edits; reload is never the happy path.
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HARNESS = process.env.CART_HARNESS_URL || 'http://127.0.0.1:4174';

async function cartRoot() {
  const res = await fetch(`${HARNESS}/__test/cart-root`);
  expect(res.ok).toBe(true);
  return (await res.json()).cartDir;
}

async function bootCart(page) {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Products', { timeout: 20000 });
  await expect(page.locator('nav')).toContainText('Shop');
}

async function editFile(relPath, transform) {
  const root = await cartRoot();
  const abs = join(root, relPath);
  const before = readFileSync(abs, 'utf8');
  writeFileSync(abs, transform(before));
  return { abs, before, restore: () => writeFileSync(abs, before) };
}

test.describe('cart publication apply', () => {
  test('leaf markup edit updates without reload through one ordered change', async ({ page }) => {
    await bootCart(page);
    await page.evaluate(() => {
      globalThis.__wsSentinel = 'alive';
      const nav = document.querySelector('nav');
      if (nav) nav.__layoutSentinel = 'alive';
    });

    const stamp = `Products ${Date.now()}`;
    const edit = await editFile('app/routes/index.rip', (src) =>
      src.replace("h1 'Products'", `h1 '${stamp}'`));

    try {
      await expect(page.locator('h1')).toHaveText(stamp, { timeout: 15000 });
      expect(await page.evaluate(() => globalThis.__wsSentinel)).toBe('alive');
      expect(await page.evaluate(() => document.querySelector('nav')?.__layoutSentinel)).toBe('alive');
      expect(await page.evaluate(() => location.pathname)).toBe('/');

      const frames = await (await fetch(`${HARNESS}/__test/frames`)).json();
      expect(frames.length).toBeGreaterThan(0);
      const last = JSON.parse(frames[frames.length - 1]);
      expect(Object.keys(last)).toEqual(['change']);
      expect(last.change.list[0][0]).toBe('routes/index.rip');
      expect(last.change.list[0][1]).toContain(stamp);
      expect(typeof last.change.from).toBe('string');
      expect(typeof last.change.hash).toBe('string');
    } finally {
      edit.restore();
    }
  });

  test('cart stash count survives a leaf route edit (Vue remount floor)', async ({ page }) => {
    await bootCart(page);
    const add = page.getByRole('button', { name: 'Add to Cart' }).first();
    await expect(add).toBeVisible({ timeout: 15000 });
    await add.click();
    await expect(page.locator('nav')).toContainText('Cart (1)', { timeout: 10000 });

    const stamp = `Products ${Date.now()}`;
    const edit = await editFile('app/routes/index.rip', (src) =>
      src.replace(/h1 '[^']*'/, `h1 '${stamp}'`));

    try {
      await expect(page.locator('h1')).toHaveText(stamp, { timeout: 15000 });
      await expect(page.locator('nav')).toContainText('Cart (1)');
    } finally {
      edit.restore();
    }
  });

  test('compile failure keeps the last good page interactive (S10)', async ({ page }) => {
    await bootCart(page);
    await page.evaluate(() => {
      globalThis.__wsSentinel = 'alive';
      globalThis.__ripHmr = [];
      window.addEventListener('rip:hmr', (e) => globalThis.__ripHmr.push(e.detail));
    });

    const edit = await editFile('app/routes/index.rip', (src) =>
      `${src}\nthis is not valid rip {{{`);

    try {
      await expect(page.locator('[data-rip-hmr-overlay]')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-rip-hmr-overlay]')).toContainText('failed to compile');
      expect(await page.evaluate(() => globalThis.__wsSentinel)).toBe('alive');
      await expect(page.locator('h1')).toHaveText('Products');
      await expect(page.locator('nav')).toContainText('Shop');
      await expect.poll(async () =>
        page.evaluate(() => globalThis.__ripHmr.some((e) => e?.type === 'reject')),
      { timeout: 5000 }).toBe(true);
    } finally {
      edit.restore();
    }

    // Restoring the good source clears the overlay (reload or successful apply).
    await expect(page.locator('[data-rip-hmr-overlay]')).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('h1')).toHaveText('Products', { timeout: 20000 });
  });

  test('profile local form state survives a compatible leaf markup edit', async ({ page }) => {
    await bootCart(page);
    await page.goto('/profile');
    await expect(page.locator('h1')).toHaveText('Profiler', { timeout: 20000 });

    const stamp = `Ada-${Date.now()}`;
    const first = page.locator('input').first();
    await first.fill(stamp);
    await expect(first).toHaveValue(stamp);

    await page.evaluate(() => {
      globalThis.__wsSentinel = 'alive';
      globalThis.__ripHmr = [];
      window.addEventListener('rip:hmr', (e) => globalThis.__ripHmr.push(e.detail));
    });

    const edit = await editFile('app/routes/profile.rip', (src) =>
      src.replace("h1 'Profiler'", `h1 'Profiler ${stamp.slice(-4)}'`));

    try {
      await expect(page.locator('h1')).toContainText('Profiler', { timeout: 15000 });
      await expect(page.locator('h1')).toContainText(stamp.slice(-4));
      // Compatible render edit: form binding should still show the typed value.
      await expect(first).toHaveValue(stamp);
      expect(await page.evaluate(() => globalThis.__wsSentinel)).toBe('alive');
      // Compatible leaf markup: must take the patch path (not remount).
      await expect.poll(async () =>
        page.evaluate(() => globalThis.__ripHmr.some((e) => e?.type === 'patch')),
      { timeout: 10000 }).toBe(true);
    } finally {
      edit.restore();
    }
  });

  test('HTML shell edit reloads the document', async ({ page }) => {
    await bootCart(page);
    await page.evaluate(() => { globalThis.__wsSentinel = 'alive'; });

    // App routes overwrite document.title — stamp the <html> attribute instead.
    const stamp = `shell-${Date.now()}`;
    const edit = await editFile('app/index.html', (src) =>
      src.replace('<html lang="en">', `<html lang="en" data-rip-shell="${stamp}">`));

    try {
      await expect.poll(async () =>
        page.evaluate(() => document.documentElement.getAttribute('data-rip-shell')),
      { timeout: 15000 }).toBe(stamp);
      // A real reload clears page-world state.
      expect(await page.evaluate(() => globalThis.__wsSentinel)).toBeUndefined();
      await expect(page.locator('h1')).toHaveText('Products', { timeout: 20000 });

      const frames = await (await fetch(`${HARNESS}/__test/frames`)).json();
      expect(frames.length).toBeGreaterThan(0);
      const last = JSON.parse(frames[frames.length - 1]);
      expect(last.change.list).toEqual([['index.html']]);
      expect(typeof last.change.hash).toBe('string');
    } finally {
      edit.restore();
    }
  });

  test('CSS-only edit soft-applies without remount (S12)', async ({ page }) => {
    await bootCart(page);
    await page.evaluate(() => {
      globalThis.__wsSentinel = 'alive';
      const nav = document.querySelector('nav');
      if (nav) nav.__layoutSentinel = 'alive';
    });
    const add = page.getByRole('button', { name: 'Add to Cart' }).first();
    await expect(add).toBeVisible({ timeout: 15000 });
    await add.click();
    await expect(page.locator('nav')).toContainText('Cart (1)', { timeout: 10000 });

    const token = `s12-${Date.now()}`;
    const edit = await editFile('app/styles.css', (src) =>
      src.replace(':root {', `:root {\n  --rip-s12: ${token};`));

    try {
      await expect.poll(async () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--rip-s12').trim()),
      { timeout: 15000 }).toBe(token);

      // Same path the page linked: /styles.css → cache-bust ?hash=
      expect(await page.evaluate(() => {
        const links = [...document.querySelectorAll('link[rel="stylesheet"][href]')];
        const link = links.find(l => (l.getAttribute('href') || '').split('?')[0] === '/styles.css'
          || (l.getAttribute('href') || '').startsWith('/styles.css?'));
        const href = link?.getAttribute('href') || '';
        return href.startsWith('/styles.css?hash=') && link?.disabled !== true;
      })).toBe(true);
      expect(await page.evaluate(() =>
        !document.querySelector('style[data-rip-css="styles.css"]'))).toBe(true);
      expect(await page.evaluate(() => globalThis.__wsSentinel)).toBe('alive');
      expect(await page.evaluate(() => document.querySelector('nav')?.__layoutSentinel)).toBe('alive');
      await expect(page.locator('nav')).toContainText('Cart (1)');

      const frames = await (await fetch(`${HARNESS}/__test/frames`)).json();
      expect(frames.length).toBeGreaterThan(0);
      const last = JSON.parse(frames[frames.length - 1]);
      expect(Object.keys(last)).toEqual(['change']);
      expect(last.change.list).toEqual([['styles.css']]);
      expect(typeof last.change.hash).toBe('string');
      expect(frames[frames.length - 1].includes('--rip-s12')).toBe(false);
    } finally {
      edit.restore();
    }
  });
});
