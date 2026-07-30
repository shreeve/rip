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
// bag populates from the served manifest, the hub feed dings modules in,
// and a change applies by remount — labeled escape, never hot apply.
// Off, every path below is byte-identical to the plain boot.
import { createModuleLoader } from './browser-modules.js';

const APP_PACKAGE = '@rip-lang/app';

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

  // Workspace mode fetches the manifest BEFORE the bundle, and the
  // manager writes it AFTER the bundle: the only pairing a boot racing
  // a save can observe is "manifest rev <= bundle bytes", which the
  // feed's open resync heals forward. The reverse pairing (a manifest
  // rev over older bundle bytes) would block its own healing on the
  // bag's rev cursor — the silent-stale class.
  const workspaceMode = opts.workspace === true;
  let manifestUrl = null;
  let fetchBytes = null;
  let manifest = null;
  if (workspaceMode) {
    // Derive from the bundle URL the same way: …/bundle.json → …/manifest.json.
    manifestUrl = opts.manifestUrl ?? opts.feed?.manifestUrl
      ?? (opts.url ? `${opts.url.slice(0, opts.url.lastIndexOf('/') + 1)}manifest.json` : null);
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
    manifest = await res.json();
  }

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

  let bag = null;
  if (workspaceMode) {
    // The workspace is part of the app package (docs/WORKSPACE.md, Q9):
    // createWorkspace and connectFeed ride the same module the launch
    // does — one graph, never a second copy.
    bag = app.createWorkspace();
    const records = [];
    for (const entry of manifest?.files ?? []) {
      // The id IS the store path (B′ — the birth path is the id).
      const source = (bundle.modules ?? {})[entry.id];
      // A manifest file the bundle does not carry is skipped here: the
      // feed's open resync fetches it by etag.
      if (source === undefined) continue;
      records.push({ id: entry.id, path: entry.id, etag: entry.etag, source });
    }
    bag.populate(records);
  }

  // Application modules (the app/ store tree) compile up front:
  // launch's renderer requires every navigable module already compiled,
  // and a page fails its boot loudly at its own position instead of
  // failing its first navigation.
  const compiled = {};
  for (const path of Object.keys(bundle.modules ?? {})) {
    if (path.startsWith('app/')) {
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
  // passport and desync bag etags from the server's. The bag already
  // holds the sources; launch only overlays projections (setCompiled
  // never changes etag or notifies).
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

  // Apply: compile barrier, then createApply chooses narrow remount
  // (route/layout; stash kept) or the labeled whole-launch escape (D7).
  // Projections rebuild THROUGH the loader; importers invalidate
  // transitively. Unchanged modules answer from the loader cache.
  let destroyed = false;
  let timer = null;
  let remounting = false;
  const pending = new Set();
  const handle = {};
  const escapeRemount = async (applied) => {
    const snapshot = {};
    for (const path of bag.paths()) {
      snapshot[path] = { ...(await loader.import(path)) };
    }
    for (const [path, module] of Object.entries(snapshot)) {
      bag.setCompiled(path, module);
    }
    current.destroy();
    current = launchWith(snapshot);
    Object.assign(handle, current, stable);
    console.log(`[Rip] applied ${applied.join(', ') || 'a change'} — remounted (component state reset)`);
  };
  const apply = app.createApply({
    renderer: {
      remountDirty: (paths) => current.renderer.remountDirty(paths),
    },
    escape: async (paths) => {
      await escapeRemount(paths);
    },
    report: (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[Rip] applied')) {
        console.log(...args);
      } else {
        report(...args);
      }
    },
  });
  const absorb = async () => {
    timer = null;
    if (destroyed) return;
    if (remounting) {
      timer = setTimeout(absorb, 25);
      return;
    }
    remounting = true;
    const applied = [...pending];
    pending.clear();
    try {
      // Compile barrier (S10/S11): stage every projection locally first.
      // A single import failure means ZERO bag.setCompiled calls and no
      // apply — last-known-good stays interactive.
      const snapshot = {};
      for (const path of bag.paths()) {
        try {
          snapshot[path] = { ...(await loader.import(path)) };
        } catch (error) {
          report(`[Rip] ${path} failed to compile — keeping the last good version`, error);
          return;
        }
      }
      if (destroyed) return;
      for (const [path, module] of Object.entries(snapshot)) {
        bag.setCompiled(path, module);
      }
      try {
        const verdict = await apply.absorb(applied);
        if (verdict === 'narrow' || verdict === 'noop') {
          Object.assign(handle, current, stable);
        }
      } catch (error) {
        report('[Rip] apply failed — waiting for the next good change', error);
      }
    } finally {
      remounting = false;
    }
  };
  const unwatch = bag.watch((_event, path) => {
    if (!path.startsWith('app/')) return;
    pending.add(path);
    timer ??= setTimeout(absorb, 25);
  });

  // The compile-through door: a passport lands in the bag already
  // projected, so ONE notify carries source and compiled together and
  // launch's rebuild never observes a source-without-projection gap.
  // A compile failure reports and never sets — last-known-good stays
  // interactive (S10).
  const door = {
    passport: bag.passport,
    sealed: bag.sealed,
    set: async passport => {
      // The bag's etag is THE staleness verdict — consult it BEFORE any
      // mutation. Two dings in flight can resolve out of order: the
      // older fetch lands after the newer one applied, and while bag.set
      // would reject a duplicate etag, the files/loader mutations below
      // would already carry stale bytes into the next remount (the
      // silent-stale class). Same guard for deletes: a replayed stale
      // delete must not evict the loader's file while the bag keeps the
      // passport.
      const known = bag.passport(passport.id);
      if (known && typeof passport.etag === 'string' && passport.etag === known.etag) {
        if (passport.deleted !== true) return false;
      }
      if (passport.deleted === true) {
        if (known && typeof passport.etag === 'string' && passport.etag !== known.etag) return false;
        const path = bag.passport(passport.id)?.path;
        if (path !== undefined) {
          files.delete(path);
          loader.invalidate(path);
        }
        return bag.set(passport);
      }
      const path = passport.path ?? passport.id;
      files.set(path, passport.source);
      loader.invalidate(path);
      let module;
      try {
        module = await loader.import(path);
      } catch (error) {
        report(`[Rip] ${path} etag ${passport.etag} failed to compile — keeping the last good version`, error);
        return false;
      }
      return bag.set({ ...passport, compiled: { ...module } });
    },
  };
  const feed = app.connectFeed(door, { ...(opts.feed ?? {}), manifestUrl, report });

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
