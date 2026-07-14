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

  // Route and app modules compile up front: launch's renderer requires
  // every navigable module already compiled, and a page fails its boot
  // loudly at its own position instead of failing its first navigation.
  const compiled = {};
  for (const path of Object.keys(bundle.modules ?? {})) {
    if (path.startsWith('_route/') || path.startsWith('_app/')) {
      compiled[path] = { ...(await loader.import(path)) };
    }
  }

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
