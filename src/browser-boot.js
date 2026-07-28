// Application boot through the browser entry: fetch the bundle (ETag
// revalidation against session storage), stand up the module graph,
// compile every route and app module through it, pull the app package
// itself out of the graph, and hand launch() a fully compiled bundle.
// Every host concern — fetch, storage, the router adapter, the mount
// target — is an option with the browser default applied only when
// omitted, so the whole boot tests under Node; the real-browser
// certification drives this same path through Playwright.
//
// Diagnostics keep their original Rip positions end to end: a module
// that fails to compile rejects the boot with its own path and line.
// `debug` compiles every module with an inline source map so devtools
// show .rip sources; it is off unless the page opts in (watch mode
// turns it on when it arrives with the server).
//
// `workspace: true` opens the dev door (docs/WORKSPACE.md, M1): the
// bag populates from the served manifest, the hub feed dings cells in,
// and a change applies by remount — labeled escape, never hot apply.
// Off, every path below is byte-identical to the plain boot.
import { createModuleLoader } from './browser-modules.js';

const APP_PACKAGE = '@rip-lang/app';
const WORKSPACE_PACKAGE = '@rip-lang/workspace';

const bootGraphs = new Map();

const browserFetchText = async (url, etag) => {
  const headers = etag ? { 'If-None-Match': etag } : {};
  const response = await fetch(url, { headers });
  if (response.status === 304) return { fresh: false };
  if (!response.ok) throw new Error(`rip: failed to fetch bundle '${url}': ${response.status} ${response.statusText}`);
  return { fresh: true, text: await response.text(), etag: response.headers.get('ETag') };
};

const browserStorage = () => {
  // A sandboxed iframe throws on the sessionStorage accessor itself.
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
};

export async function fetchBundle(url, { fetchText = browserFetchText, storage = browserStorage() } = {}) {
  if (!url) throw new Error('rip: fetchBundle requires a url');
  const etagKey = `__rip_bundle_etag:${url}`;
  const bodyKey = `__rip_bundle_body:${url}`;
  const attempt = async conditional => {
    const knownTag = conditional ? storage?.getItem(etagKey) ?? null : null;
    const cached = knownTag ? storage?.getItem(bodyKey) ?? null : null;
    const result = await fetchText(url, cached ? knownTag : null);
    if (!result.fresh) {
      if (!cached) throw new Error(`rip: bundle '${url}' revalidated with no cached body`);
      try {
        return JSON.parse(cached);
      } catch {
        // A poisoned cache self-heals: drop both keys and refetch
        // unconditionally instead of bricking the whole session.
        try {
          storage?.removeItem?.(etagKey);
          storage?.removeItem?.(bodyKey);
        } catch {}
        return undefined;
      }
    }
    let bundle;
    try {
      bundle = JSON.parse(result.text);
    } catch (error) {
      throw new Error(`rip: bundle '${url}' is not valid JSON: ${error.message}`);
    }
    // The body caches only once it parsed — a transient bad response
    // must never become tomorrow's poisoned 304.
    if (result.etag && storage) {
      try {
        storage.setItem(etagKey, result.etag);
        storage.setItem(bodyKey, result.text);
      } catch {
        // Storage quota is advisory; the bundle still boots.
      }
    }
    return bundle;
  };
  return await attempt(true) ?? await attempt(false);
}

export async function bootApp(opts = {}) {
  if (!opts.bundle && !opts.url) {
    throw new Error('rip: bootApp requires a bundle or a url');
  }
  // The bundle cache and launch's persist backend are different
  // storages with different lifetimes: `bundleStorage` never collides
  // with the `storage` option that persistStash consumes.
  const fetchOpts = {};
  if (opts.fetchText) fetchOpts.fetchText = opts.fetchText;
  if ('bundleStorage' in opts) fetchOpts.storage = opts.bundleStorage;
  const bundle = opts.bundle ?? await fetchBundle(opts.url, fetchOpts);
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('rip: bootApp requires a bundle or a url');
  }
  const appEntry = bundle.packages?.[APP_PACKAGE];
  if (!appEntry) {
    throw new Error(
      `rip: the bundle carries no '${APP_PACKAGE}' package — assemble the application with its packages`,
    );
  }

  // The loader's registry contract is four functions; the boot's own
  // minimal store satisfies it, and launch() builds the application's
  // real component store from the same bundle afterwards. The graph is
  // cached per app-package fingerprint: the renderer claims its
  // construction capability exactly once per page, so a relaunch with
  // the same app sources reuses the evaluated graph instead of
  // claiming twice; changed app sources — or a flipped debug mode —
  // are a new application and reject loudly through the claim. Watch
  // mode owns the debug transition with a full reload.
  const debug = opts.debug === true;
  const appPaths = Object.keys(bundle.modules ?? {}).filter(path => path.startsWith(`${appEntry.root}/`)).sort();
  const fingerprint = `${debug}:${JSON.stringify(appPaths.map(path => [path, bundle.modules[path]]))}`;
  let graph = bootGraphs.get(fingerprint);
  if (!graph) {
    const files = new Map();
    const compiledStore = new Map();
    const registry = {
      read: path => files.get(path),
      exists: path => files.has(path),
      getCompiled: path => compiledStore.get(path),
      setCompiled: (path, module) => void compiledStore.set(path, module),
    };
    // `packages` stays this one mutable table: the loader resolves
    // bare specifiers through it at import time, so each boot syncs it
    // to ITS bundle instead of freezing the first bundle's view.
    const packages = {};
    graph = { files, packages, loader: createModuleLoader({ components: registry, packages, debug }) };
    bootGraphs.set(fingerprint, graph);
  }
  const { files, packages, loader } = graph;
  for (const name of Object.keys(packages)) {
    if (!(name in (bundle.packages ?? {}))) delete packages[name];
  }
  Object.assign(packages, bundle.packages ?? {});
  // Sync the shared graph to this bundle: changed sources invalidate
  // (transitively, through the loader), and paths this bundle does not
  // carry are forgotten — a leftover module must not resolve silently.
  const modules = bundle.modules ?? {};
  for (const path of [...files.keys()]) {
    if (modules[path] === undefined) {
      files.delete(path);
      loader.invalidate(path);
    }
  }
  for (const [path, source] of Object.entries(modules)) {
    if (files.get(path) !== source) {
      files.set(path, source);
      loader.invalidate(path);
    }
  }

  const app = await loader.import(`${appEntry.root}/${appEntry.entry}`);

  const workspaceMode = opts.workspace === true;
  let createWorkspace = null;
  let connectFeed = null;
  let manifestUrl = null;
  let fetchBytes = null;
  let bag = null;
  if (workspaceMode) {
    // The workspace package rides the bundle like the app package
    // does, and loads through the same graph — never a second copy.
    const wsEntry = bundle.packages?.[WORKSPACE_PACKAGE];
    if (!wsEntry) {
      throw new Error(
        `rip: workspace mode requires the '${WORKSPACE_PACKAGE}' package, which this bundle does not carry — ` +
        'serve under RIP_WORKSPACE=1 so assembly claims it',
      );
    }
    ({ createWorkspace } = await loader.import(`${wsEntry.root}/${wsEntry.entry}`));
    const feedSub = wsEntry.exports?.['./feed'];
    if (!feedSub) {
      throw new Error(`rip: the '${WORKSPACE_PACKAGE}' package carries no './feed' export`);
    }
    ({ connectFeed } = await loader.import(`${wsEntry.root}/${feedSub}`));

    manifestUrl = opts.manifestUrl ?? opts.feed?.manifestUrl
      ?? (opts.url ? `${opts.url.slice(0, opts.url.lastIndexOf('/') + 1)}manifest` : null);
    if (!manifestUrl) {
      throw new Error(
        'rip: workspace mode booted from a bundle object, so no manifest url derives from the bundle url — pass opts.manifestUrl',
      );
    }
    fetchBytes = opts.feed?.fetch ?? (url => fetch(url));
    const res = await fetchBytes(manifestUrl);
    if (!res.ok) {
      throw new Error(`rip: workspace manifest fetch failed: '${manifestUrl}' answered ${res.status}`);
    }
    const manifest = await res.json();
    bag = createWorkspace();
    const records = [];
    for (const entry of manifest?.cells ?? []) {
      const path = typeof entry.path === 'string' ? entry.path : entry.id;
      const source = (bundle.modules ?? {})[path];
      // A manifest cell the bundle does not carry is skipped here: the
      // feed's open resync fetches it rev-keyed.
      if (source === undefined) continue;
      records.push({ id: entry.id, path, rev: entry.rev, source });
    }
    bag.populate(records);
  }

  // Route and app modules compile up front: launch's renderer requires
  // every navigable module already compiled, and a page fails its boot
  // loudly at its own position instead of failing its first navigation.
  const compiled = {};
  for (const path of Object.keys(bundle.modules ?? {})) {
    if (path.startsWith('_route/') || path.startsWith('_app/')) {
      compiled[path] = { ...(await loader.import(path)) };
    }
  }

  if (!workspaceMode) {
    return app.launch({
      bundle: { modules: bundle.modules, compiled, data: bundle.data },
      target: opts.target,
      adapter: opts.adapter,
      base: opts.base,
      hash: opts.hash,
      persist: opts.persist,
      storage: opts.storage,
      onError: opts.onError,
    });
  }

  // The bag IS the component store (Q7), and the launch bundle carries
  // NO modules key on purpose: launch's load() would rewrite every
  // passport and bump every rev, desyncing the bag's rev cursor from
  // the server's. The bag already holds the sources; launch only
  // overlays projections (setCompiled never bumps a rev or notifies).
  const launchWith = compiledModules => app.launch({
    bundle: { compiled: compiledModules, data: bundle.data },
    components: bag,
    target: opts.target,
    adapter: opts.adapter,
    base: opts.base,
    hash: opts.hash,
    persist: opts.persist,
    storage: opts.storage,
    onError: opts.onError,
  });
  let current = launchWith(compiled);

  const report = opts.feed?.report ?? ((...args) => console.error(...args));

  // The escape apply: any route or app mutation coalesces into one
  // remount of the whole launch against the same bag — the cached
  // graph makes the relaunch legal (no second renderer claim). This is
  // the labeled escape (D7), not hot apply.
  let destroyed = false;
  let timer = null;
  const handle = {};
  const remount = () => {
    timer = null;
    if (destroyed) return;
    const snapshot = {};
    for (const path of bag.paths()) {
      const module = bag.getCompiled(path);
      if (module) snapshot[path] = module;
    }
    current.destroy();
    current = launchWith(snapshot);
    Object.assign(handle, current, stable);
    console.log('[Rip] workspace: change applied by remount (escape, not hot apply)');
  };
  const unwatch = bag.watch((_event, path) => {
    if (!path.startsWith('_route/') && !path.startsWith('_app/')) return;
    timer ??= setTimeout(remount, 25);
  });

  // The compile-through door: a cell lands in the bag already
  // projected, so ONE notify carries source and compiled together and
  // launch's rebuild never observes a source-without-projection gap.
  // A compile failure reports and never sets — last-known-good stays
  // interactive (S10).
  const door = {
    passport: bag.passport,
    sealed: bag.sealed,
    set: async cell => {
      if (cell.deleted === true) {
        const path = bag.passport(cell.id)?.path;
        if (path !== undefined) {
          files.delete(path);
          loader.invalidate(path);
        }
        return bag.set(cell);
      }
      const path = cell.path ?? cell.id;
      files.set(path, cell.source);
      loader.invalidate(path);
      let module;
      try {
        module = await loader.import(path);
      } catch (error) {
        report(`[Rip] workspace: '${path}' rev ${cell.rev} failed to compile — keeping the last good revision`, error);
        return false;
      }
      return bag.set({ ...cell, compiled: { ...module } });
    },
  };
  const feed = connectFeed(door, { ...(opts.feed ?? {}), manifestUrl, report });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    unwatch();
    feed.close();
    current.destroy();
  };
  const stable = { workspace: bag, feed, destroy };
  return Object.assign(handle, current, stable);
}
