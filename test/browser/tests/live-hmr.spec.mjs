// HMR certification: the Workspace publication substrate (docs/WORKSPACE.md)
// and every refresh tier in docs/HMR.md, driven by real disk edits against a
// real `rip site`.
//
// The subject is test/browser/hmr-app — a fixture this suite owns outright,
// not a demo. Tiers are chosen from compiler signatures
// (src/runtime/components.js __hmrClassify), so each tier is reached by one
// deliberate edit to that fixture:
//
//   patch    render-only change — props, `:=`, `~=`, gates, extends all equal
//   migrate  a changed `:=` / `~=` name set — intersecting slots are carried
//   remount  a changed `@prop` set, gate count, or `extends` tag
//   reload   the App shell, or a graph the runtime cannot isolate
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HARNESS = process.env.RIP_HARNESS_URL || 'http://127.0.0.1:4175';

const ROUTE = 'app/routes/index.rip';

async function appRoot() {
  const res = await fetch(`${HARNESS}/__test/app-root`);
  expect(res.ok).toBe(true);
  return (await res.json()).appDir;
}

async function frames() {
  return (await fetch(`${HARNESS}/__test/frames`)).json();
}

/** Boot the fixture, arm the sentinels, and record every tier event. */
async function boot(page) {
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('home', { timeout: 20000 });
  await expect(page.locator('#brand')).toHaveText('fixture');
  await page.evaluate(() => {
    globalThis.__wsSentinel = 'alive';
    // Layout identity: a remount below the layout must not clear this.
    const nav = document.querySelector('nav');
    if (nav) nav.__layoutSentinel = 'alive';
    globalThis.__ripHmr = [];
    window.addEventListener('rip:hmr', (e) => globalThis.__ripHmr.push(e.detail));
  });
}

const tiers = (page) => page.evaluate(() => globalThis.__ripHmr.map((e) => e.type));
const tier = (page, type) =>
  page.evaluate((t) => globalThis.__ripHmr.find((e) => e.type === t) ?? null, type);
const sentinels = (page) => page.evaluate(() => ({
  page: globalThis.__wsSentinel,
  layout: document.querySelector('nav')?.__layoutSentinel,
}));

/** Raise `count` (a `:=` slot) and `hits` (stash) to a known, equal value. */
async function bump(page, times = 1) {
  for (let i = 0; i < times; i += 1) await page.locator('#bump').click();
  await expect(page.locator('#count')).toHaveText(String(times));
  await expect(page.locator('#hits')).toHaveText(String(times));
}

async function editFile(relPath, transform) {
  const root = await appRoot();
  const abs = join(root, relPath);
  const before = readFileSync(abs, 'utf8');
  const after = transform(before);
  expect(after, `${relPath}: transform matched nothing`).not.toBe(before);
  writeFileSync(abs, after);
  return {
    abs,
    restore: () => writeFileSync(abs, before),
    /** Restore and wait for the page to settle, so the next test starts clean. */
    async restoreAndSettle(locator, text) {
      writeFileSync(abs, before);
      await expect(locator).toHaveText(text, { timeout: 20000 });
    },
    /**
     * Same, for a signature change whose restore moves no text on screen —
     * wait for the restore's own tier event instead. Settling on a value the
     * page already shows would return instantly and let the next test edit a
     * file whose republication is still in flight.
     */
    async restoreAndSettleTier(page) {
      const seen = await page.evaluate(() => globalThis.__ripHmr?.length ?? 0);
      writeFileSync(abs, before);
      await expect
        .poll(() => page.evaluate(() => globalThis.__ripHmr?.length ?? 0), { timeout: 20000 })
        .toBeGreaterThan(seen);
    },
  };
}

const retitle = (title) => (src) => src.replace(/h1#title '[^']*'/, `h1#title '${title}'`);

test.describe('workspace publication substrate', () => {
  test('a leaf edit publishes one ordered change carrying its source', async ({ page }) => {
    await boot(page);
    const title = `home-${Date.now().toString(36)}`;
    const edit = await editFile(ROUTE, retitle(title));

    try {
      await expect(page.locator('#title')).toHaveText(title, { timeout: 15000 });
      expect(await page.evaluate(() => location.pathname)).toBe('/');
      expect(await sentinels(page)).toEqual({ page: 'alive', layout: 'alive' });

      const log = await frames();
      const last = JSON.parse(log[log.length - 1]);
      expect(Object.keys(last)).toEqual(['change']);
      expect(Object.keys(last.change).sort()).toEqual(['from', 'hash', 'list']);
      expect(last.change.list[0][0]).toBe('routes/index.rip');
      expect(last.change.list[0][1]).toContain(title);
    } finally {
      await edit.restoreAndSettle(page.locator('#title'), 'home');
    }
  });

  test('a CSS edit refreshes through HTTP identity, never inline', async ({ page }) => {
    await boot(page);
    await bump(page);

    const token = `css-${Date.now().toString(36)}`;
    const edit = await editFile('app/styles.css', (src) =>
      `${src}\n:root { --fixture-probe: ${token}; }\n`);

    try {
      await expect.poll(() => page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--fixture-probe').trim()),
      { timeout: 15000 }).toBe(token);

      // Same path the page linked, cache-busted — not a swapped-in <style>.
      expect(await page.evaluate(() => {
        const link = [...document.querySelectorAll('link[rel="stylesheet"][href]')]
          .find((l) => (l.getAttribute('href') || '').split('?')[0] === '/styles.css');
        return (link?.getAttribute('href') || '').startsWith('/styles.css?hash=')
          && link?.disabled !== true;
      })).toBe(true);
      expect(await page.evaluate(() =>
        !document.querySelector('style[data-rip-css="styles.css"]'))).toBe(true);

      // A soft CSS refresh touches no component: no tier event, state intact.
      expect(await tiers(page)).toEqual([]);
      await expect(page.locator('#count')).toHaveText('1');
      expect(await sentinels(page)).toEqual({ page: 'alive', layout: 'alive' });

      // Stylesheet bytes ride HTTP, not the change frame.
      const log = await frames();
      const last = log[log.length - 1];
      expect(JSON.parse(last).change.list).toEqual([['styles.css']]);
      expect(last.includes(token)).toBe(false);
    } finally {
      edit.restore();
      await expect
        .poll(() => page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--fixture-probe').trim()),
        { timeout: 20000 }).toBe('');
    }
  });

  test('a shell edit reloads the document', async ({ page }) => {
    await boot(page);
    const token = `shell-${Date.now().toString(36)}`;
    const edit = await editFile('app/index.html', (src) =>
      src.replace(/<html\b([^>]*)>/, `<html$1 data-rip-shell="${token}">`));

    try {
      await expect.poll(() => page.evaluate(() =>
        document.documentElement.getAttribute('data-rip-shell')), { timeout: 15000 }).toBe(token);
      // A real reload clears page-world state.
      expect((await sentinels(page)).page).toBeUndefined();
      await expect(page.locator('#title')).toHaveText('home', { timeout: 20000 });

      const log = await frames();
      expect(JSON.parse(log[log.length - 1]).change.list).toEqual([['index.html']]);
    } finally {
      edit.restore();
      await expect
        .poll(() => page.evaluate(() =>
          document.documentElement.getAttribute('data-rip-shell')), { timeout: 20000 }).toBeNull();
    }
  });
});

test.describe('refresh tiers', () => {
  // Patch — the narrowest tier: the instance itself survives.
  test('a render-only edit patches and keeps the live instance', async ({ page }) => {
    await boot(page);
    await bump(page);

    const title = `home-${Date.now().toString(36)}`;
    const edit = await editFile(ROUTE, retitle(title));

    try {
      await expect(page.locator('#title')).toHaveText(title, { timeout: 15000 });
      await expect.poll(() => tiers(page), { timeout: 10000 }).toContain('patch');
      expect(await tiers(page)).not.toContain('remount');
      // The `:=` slot is the same slot on the same instance.
      await expect(page.locator('#count')).toHaveText('1');
      await expect(page.locator('#hits')).toHaveText('1');
      expect(await sentinels(page)).toEqual({ page: 'alive', layout: 'alive' });
    } finally {
      await edit.restoreAndSettle(page.locator('#title'), 'home');
    }
  });

  // Migrate — a changed `:=` name set: a fresh instance on the remount
  // floor, carrying the slots both versions share.
  test('an added state slot migrates, carrying the intersecting slots', async ({ page }) => {
    await boot(page);
    await bump(page);

    const edit = await editFile(ROUTE, (src) =>
      src.replace('  count := 0\n', '  count := 0\n  extra := 7\n'));

    try {
      await expect.poll(() => tiers(page), { timeout: 15000 }).toContain('migrate');

      // Diagnostics name every slot: kept, added, removed, and carried.
      expect(await tier(page, 'migrate')).toMatchObject({
        kept: ['count'], added: ['extra'], removed: [], copied: ['count'],
      });
      // Migrate rides the remount floor, and only the route is rebuilt:
      // `from: 1` is the route's index in [layout, route].
      expect(await tier(page, 'remount')).toMatchObject({
        paths: ['routes/index.rip'], from: 1, migrate: 1,
      });

      // The carried slot kept its value; the layout and stash never moved.
      await expect(page.locator('#count')).toHaveText('1');
      await expect(page.locator('#hits')).toHaveText('1');
      await expect(page.locator('#brand')).toHaveText('fixture');
      expect(await sentinels(page)).toEqual({ page: 'alive', layout: 'alive' });
    } finally {
      await edit.restoreAndSettleTier(page);
    }
  });

  // Remount — an incompatible contract. State is dropped on purpose; the
  // ancestors above the dirty boundary, and the stash, are not.
  test('a changed prop set remounts and drops local state, keeping ancestors', async ({ page }) => {
    await boot(page);
    await bump(page);

    const edit = await editFile(ROUTE, (src) =>
      src.replace('export Home = component\n', 'export Home = component\n  @flag?: boolean\n'));

    try {
      await expect.poll(() => tiers(page), { timeout: 15000 }).toContain('remount');
      // No slot is carried: an incompatible contract cannot claim the old state.
      expect(await tier(page, 'remount')).toMatchObject({
        paths: ['routes/index.rip'], from: 1, migrate: 0,
      });
      expect(await tiers(page)).not.toContain('migrate');

      await expect(page.locator('#count')).toHaveText('0');
      // Above the boundary: layout node identity and the stash both survive.
      await expect(page.locator('#hits')).toHaveText('1');
      await expect(page.locator('#brand')).toHaveText('fixture');
      expect(await sentinels(page)).toEqual({ page: 'alive', layout: 'alive' });
    } finally {
      await edit.restoreAndSettleTier(page);
    }
  });

  // A layout patch rebuilds the layout's view and reseats the route below it.
  test('a layout edit patches and keeps the mounted route seated', async ({ page }) => {
    await boot(page);
    await bump(page);

    const brand = `fixture-${Date.now().toString(36)}`;
    const edit = await editFile('app/routes/_layout.rip', (src) =>
      src.replace(/strong#brand '[^']*'/, `strong#brand '${brand}'`));

    try {
      await expect(page.locator('#brand')).toHaveText(brand, { timeout: 15000 });
      await expect.poll(() => tiers(page), { timeout: 10000 }).toContain('patch');
      expect(await tiers(page)).not.toContain('remount');
      // The route below is still on screen, in the live slot, with its state.
      await expect(page.locator('#content #title')).toHaveText('home');
      await expect(page.locator('#count')).toHaveText('1');
      // And the slot still receives the next navigation.
      await page.locator('#nav-form').click();
      await expect(page.locator('#content #title')).toHaveText('form', { timeout: 15000 });
    } finally {
      await edit.restoreAndSettle(page.locator('#brand'), 'fixture');
    }
  });
});

test.describe('tier events', () => {
  // noop — a dirty module with no living instance touches nothing, and the
  // committed source still reaches the route at its next mount.
  test('an edit to an unmounted route is a noop, and lands on navigation', async ({ page }) => {
    await boot(page);
    await bump(page);

    const title = `idle-${Date.now().toString(36)}`;
    const edit = await editFile('app/routes/idle.rip', retitle(title));

    try {
      await expect.poll(() => page.evaluate(() => globalThis.__ripHmr.some((e) =>
        e?.type === 'noop' && e.paths?.includes('routes/idle.rip'))), { timeout: 15000 }).toBe(true);
      expect(await tiers(page)).not.toContain('remount');
      // Nothing on the current page moved.
      await expect(page.locator('#title')).toHaveText('home');
      await expect(page.locator('#count')).toHaveText('1');
      expect(await sentinels(page)).toEqual({ page: 'alive', layout: 'alive' });

      await page.locator('#nav-idle').click();
      await expect(page.locator('#content #title')).toHaveText(title, { timeout: 15000 });
    } finally {
      await edit.restoreAndSettle(page.locator('#content #title'), 'idle');
    }
  });

  // reject — a compile failure quarantines the candidate. The last good page
  // stays interactive, and recovery applies the fix in place.
  test('a compile failure keeps the last good page interactive, then recovers', async ({ page }) => {
    await boot(page);
    await bump(page);

    const root = await appRoot();
    const abs = join(root, ROUTE);
    const original = readFileSync(abs, 'utf8');
    const title = `home-${Date.now().toString(36)}`;

    try {
      writeFileSync(abs, `${original}\nthis is not valid rip {{{`);
      await expect(page.locator('[data-rip-hmr-overlay]')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-rip-hmr-overlay]')).toContainText('failed to compile');
      await expect.poll(() => tiers(page), { timeout: 10000 }).toContain('reject');

      // Last known good: still rendered, still holding state, still clickable.
      await expect(page.locator('#title')).toHaveText('home');
      await expect(page.locator('#count')).toHaveText('1');
      expect(await sentinels(page)).toEqual({ page: 'alive', layout: 'alive' });
      // The overlay is deliberately modal (fixed, inset 0, pointer-events
      // auto), so a real click lands on it. Dispatch straight to the button:
      // what is under test is that the app still runs, not that the overlay
      // is click-through.
      await page.locator('#bump').dispatchEvent('click');
      await expect(page.locator('#count')).toHaveText('2');

      // Recovery applies the good edit in place — no reload, state intact.
      writeFileSync(abs, retitle(title)(original));
      await expect(page.locator('[data-rip-hmr-overlay]')).toHaveCount(0, { timeout: 20000 });
      await expect(page.locator('#title')).toHaveText(title, { timeout: 20000 });
      await expect(page.locator('#count')).toHaveText('2');
      expect(await sentinels(page)).toEqual({ page: 'alive', layout: 'alive' });
    } finally {
      writeFileSync(abs, original);
      await expect(page.locator('#title')).toHaveText('home', { timeout: 20000 });
    }
  });
});

test.describe('ui restoration', () => {
  test('focus and caret survive a rebuilt view', async ({ page }) => {
    await boot(page);
    await page.locator('#nav-form').click();
    await expect(page.locator('#content #title')).toHaveText('form', { timeout: 15000 });

    const field = page.locator('#field');
    const value = await field.inputValue();
    expect(value.length).toBeGreaterThan(2);
    await field.click();
    await page.evaluate(() => document.getElementById('field').setSelectionRange(2, 2));

    const title = `form-${Date.now().toString(36)}`;
    const edit = await editFile('app/routes/form.rip', retitle(title));

    try {
      await expect(page.locator('#content #title')).toHaveText(title, { timeout: 15000 });
      await expect.poll(() => tiers(page), { timeout: 10000 }).toContain('patch');
      // Focus comes back by locator, with the caret where it was.
      expect(await page.evaluate(() => ({
        focused: document.activeElement === document.getElementById('field'),
        caret: document.activeElement?.selectionStart,
      }))).toEqual({ focused: true, caret: 2 });
      // Typing lands in the field, at the caret.
      await page.keyboard.type('X');
      await expect(field).toHaveValue(`${value.slice(0, 2)}X${value.slice(2)}`);
    } finally {
      await edit.restoreAndSettle(page.locator('#content #title'), 'form');
    }
  });
});
