// The compiled-module cache against real IndexedDB: a booted page stores
// its compiled modules, a reload runs them without compiling (proven by a
// planted entry whose code was compiled from different source than the
// one it is filed under), and a store left unopened past its idle window
// is dropped whole.
import { expect, test } from '@playwright/test';

const booted = page => expect.poll(() => page.evaluate(() => globalThis.__bootResult)).toBe('ok');

const storedPaths = page => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('rip-compiled-modules');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const all = db.transaction('modules').objectStore('modules').getAll();
    all.onsuccess = () => {
      db.close();
      resolve(all.result.map(entry => entry.path).sort());
    };
  };
}));

test('a reload runs stored compiled modules without compiling them', async ({ page }) => {
  await page.goto('/');
  await booted(page);
  await expect(page.locator('#title')).toHaveText('home');
  await expect.poll(() => storedPaths(page)).toEqual(['routes/index.rip', 'routes/profile.rip', 'seed.rip', 'stash.rip']);

  await page.evaluate(async () => {
    const { compile } = await import('/dist/@rip/rip.js');
    const planted = compile(
      ['export Home = component', '  render', '    h1#title "from cache"'].join('\n'),
      { path: 'routes/index.rip', runtimeDelivery: 'import', browserModule: true },
    );
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('rip-compiled-modules');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('modules', 'readwrite');
        const modules = tx.objectStore('modules');
        const get = modules.get('routes/index.rip');
        get.onsuccess = () => {
          const entry = get.result;
          entry.code = planted.code;
          entry.imports = planted.imports.map(({ start, end, specifier }) => ({ start, end, specifier }));
          modules.put(entry);
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
    });
  });

  await page.reload();
  await booted(page);
  await expect(page.locator('#title')).toHaveText('from cache');
});

test('a store unopened past its idle window is dropped whole', async ({ page }) => {
  await page.goto('/');
  await booted(page);
  const sizes = await page.evaluate(async () => {
    const { openModuleCache } = await import('/dist/@rip/rip.js');
    const day = 24 * 60 * 60 * 1000;
    let at = 0;
    const store = openModuleCache({ name: 'rip-idle-probe', now: () => at });
    await store.read();
    await store.write(new Map([['a.rip', { path: 'a.rip' }]]));
    at = 29 * day;
    const kept = (await store.read()).size;
    at += 31 * day;
    const dropped = (await store.read()).size;
    return [kept, dropped];
  });
  expect(sizes).toEqual([1, 0]);
});
