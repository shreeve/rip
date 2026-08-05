// Browser publication consumer. Rip Sites publishes {hash,list}; this layer
// validates and compiles that complete Rip program, launches App from prepared
// state, and optionally applies ordered watch changes. HTTP caching remains the
// browser's job—boot does not keep its own ETag/body cache.
import { createModuleLoader } from './browser-modules.js';
import { app, embeddedPackages } from './browser-app.js';
import { validatePrepared } from '../packages/app/launch.rip';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validHash = value => typeof value === 'string' && /^[A-Za-z0-9_]{6}$/.test(value);

const validPath = (path, ripOnly = false) => {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\\')) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) return false;
  if (ripOnly) {
    const filename = parts.at(-1);
    if (filename === '.rip' || !filename.endsWith('.rip') || parts.slice(0, -1).some(part => part.endsWith('.rip'))) return false;
  }
  return true;
};

const exactKeys = (value, keys) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const publicationSources = bundle => {
  if (!isRecord(bundle) || !exactKeys(bundle, ['hash', 'list']) || !validHash(bundle.hash) || !Array.isArray(bundle.list)) {
    throw new Error('rip: bundle must contain exactly one hash and one source list');
  }
  const sources = {};
  let prior = null;
  for (const entry of bundle.list) {
    if (!Array.isArray(entry) || entry.length !== 2 || !validPath(entry[0], true) || typeof entry[1] !== 'string' || (prior !== null && prior >= entry[0])) {
      throw new Error(`rip: bundle has a malformed or unsorted source entry: ${JSON.stringify(entry)}`);
    }
    if (entry[0] === '@rip-lang/app' || entry[0].startsWith('@rip-lang/app/')) {
      throw new Error(`rip: bundle source '${entry[0]}' collides with embedded package '@rip-lang/app'`);
    }
    prior = entry[0];
    sources[entry[0]] = entry[1];
  }
  return sources;
};

const parseChange = change => {
  if (!isRecord(change) || !exactKeys(change, ['from', 'hash', 'list']) || !validHash(change.from) || !validHash(change.hash) || !Array.isArray(change.list)) {
    throw new Error('rip: publication change must contain exactly from, hash, and list');
  }
  let prior = null;
  const entries = [];
  for (const tuple of change.list) {
    if (!Array.isArray(tuple) || tuple.length < 1 || tuple.length > 2 || !validPath(tuple[0]) || (prior !== null && prior >= tuple[0])) {
      throw new Error(`rip: publication change has a malformed or unsorted entry: ${JSON.stringify(tuple)}`);
    }
    const [path] = tuple;
    const deletion = tuple.length === 2 && tuple[1] === null;
    if (path.endsWith('.rip')) {
      if (tuple.length !== 2 || (!deletion && typeof tuple[1] !== 'string')) {
        throw new Error(`rip: Rip change '${path}' must carry source or null`);
      }
    } else if (tuple.length === 2 && !deletion) {
      throw new Error(`rip: ordinary asset change '${path}' cannot carry content`);
    }
    prior = path;
    entries.push({ path, source: tuple[1], deletion });
  }
  return { from: change.from, hash: change.hash, entries };
};

const browserFetchText = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`rip: failed to fetch bundle '${url}': ${response.status} ${response.statusText}`);
  return response.text();
};

export async function fetchBundle(url, { fetchText = browserFetchText } = {}) {
  if (!url) throw new Error('rip: fetchBundle requires a url');
  const result = await fetchText(url);
  const text = typeof result === 'string' ? result : result?.text;
  if (typeof text !== 'string') throw new Error(`rip: bundle '${url}' fetch did not return text`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`rip: bundle '${url}' is not valid JSON: ${error.message}`);
  }
}

const createProgram = (initialSources, debug) => {
  let files = new Map(Object.entries(initialSources));
  const staged = new Map();
  const registry = {
    read: path => files.get(path),
    exists: path => files.has(path),
    getCompiled: path => staged.get(path),
    setCompiled: (path, module) => void staged.set(path, module),
  };
  const loader = createModuleLoader({ components: registry, embeddedPackages, debug });
  return {
    sources(nextSources) {
      files = new Map(Object.entries(nextSources));
    },
    async compile(changed = []) {
      const invalidated = new Set();
      for (const path of changed) {
        for (const affected of loader.invalidate(path)) invalidated.add(affected);
      }
      try {
        const compiled = {};
        for (const path of files.keys()) {
          if (!path.startsWith('@rip-lang/')) compiled[path] = { ...(await loader.import(path)) };
        }
        return { compiled, invalidated: [...invalidated] };
      } finally {
        await loader.collect();
      }
    },
    dispose: () => loader.dispose(),
  };
};

const sibling = (url, name) => {
  const clean = url.split('?')[0];
  return `${clean.slice(0, clean.lastIndexOf('/') + 1)}${name}`;
};

export async function bootApp(opts = {}) {
  if (!opts.bundle && !opts.url) throw new Error('rip: bootApp requires a bundle or a url');
  const bundle = opts.bundle ?? await fetchBundle(opts.url, { fetchText: opts.fetchText });
  const sources = publicationSources(bundle);
  const debug = opts.debug === true;
  const program = createProgram(sources, debug);
  const workspace = app.createWorkspace();
  const dataFor = modules => modules['data.rip']?.data;
  const launchWith = modules => app.launch({
    bundle: { compiled: modules, data: dataFor(modules) },
    components: workspace,
    target: opts.target,
    adapter: opts.adapter,
    base: opts.base,
    hash: opts.hash,
    persist: opts.persist,
    storage: opts.storage,
    onError: opts.onError,
  });

  let current;
  try {
    const { compiled } = await program.compile();
    workspace.activate({ hash: bundle.hash, sources, compiled });
    current = launchWith(compiled);
  } catch (error) {
    program.dispose();
    throw error;
  }
  let feed = null;
  let destroyed = false;
  const handle = {};
  const report = opts.feed?.report ?? ((...args) => console.error(...args));
  const reload = reason => {
    report(`[Rip] reloading${reason ? ` — ${reason}` : ''}`);
    if (typeof opts.reload === 'function') opts.reload(reason);
    else if (typeof location !== 'undefined') location.reload();
  };

  const cssLinksFor = path => {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
    const matches = new Set();
    const baseUrl = new URL(typeof location === 'undefined' ? 'http://rip.invalid/' : location.href);
    const publicationUrl = new URL('/', baseUrl);
    publicationUrl.pathname = `/${path.replaceAll('%', '%25')}`;
    const suffix = publicationUrl.pathname;
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const explicit = link.getAttribute('data-rip-css') === path;
      if (explicit) matches.add(link);
      const href = link.getAttribute('href') || '';
      if (!href) continue;
      let url;
      try {
        url = new URL(href, baseUrl);
      } catch {
        continue;
      }
      if (!explicit && url.origin === baseUrl.origin && (url.pathname === suffix || url.pathname.endsWith(suffix))) matches.add(link);
    }
    return [...matches];
  };

  const refreshCss = (path, hash) => {
    for (const link of cssLinksFor(path)) {
      const href = link.getAttribute('href') || link.href;
      const fragmentAt = href.indexOf('#');
      const fragment = fragmentAt < 0 ? '' : href.slice(fragmentAt);
      const request = fragmentAt < 0 ? href : href.slice(0, fragmentAt);
      const clean = request.split('?')[0];
      link.setAttribute('href', `${clean}?hash=${encodeURIComponent(hash)}${fragment}`);
      link.disabled = false;
    }
  };

  const apply = app.createApply({
    renderer: { remountDirty: (paths, candidate) => current.renderer.remountDirty(paths, candidate) },
    escape: async () => 'reload',
    report: (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[Rip] applied')) console.log(...args);
      else report(...args);
    },
  });

  const applyChange = async wire => {
    let change;
    try {
      change = parseChange(wire);
    } catch (error) {
      report('[Rip] malformed publication change:', error);
      return 'reload';
    }
    if (workspace.hash() === change.hash) return true;
    if (workspace.hash() !== change.from) return 'reload';

    const activeSources = () => Object.fromEntries(workspace.listAll().map(path => [path, workspace.read(path)]));
    const nextSources = activeSources();
    const changedRip = [];
    for (const entry of change.entries) {
      if (!entry.path.endsWith('.rip')) continue;
      changedRip.push(entry.path);
      if (entry.deletion) delete nextSources[entry.path];
      else nextSources[entry.path] = entry.source;
    }

    let nextCompiled;
    let applyPaths;
    try {
      program.sources(nextSources);
      const staged = await program.compile(changedRip);
      nextCompiled = staged.compiled;
      applyPaths = staged.invalidated.filter(path => !path.startsWith('@rip-lang/'));
      validatePrepared({ compiled: nextCompiled, data: dataFor(nextCompiled) });
    } catch (error) {
      program.sources(activeSources());
      report('[Rip] changed Rip program failed to compile:', error);
      return 'rejected';
    }

    // Every Rip entry has now passed complete candidate preflight. CSS can
    // refresh through normal HTTP; other assets and mounted-route deletion
    // require the valid complete bundle to activate through document reload.
    const ordinaryReload = change.entries.some(entry =>
      !entry.path.endsWith('.rip') && (!entry.path.endsWith('.css') || entry.deletion));
    const route = current.router.current;
    const mounted = new Set([
      ...(route?.layouts ?? route?.route?.layouts ?? []),
      route?.route?.file,
    ].filter(Boolean));
    const mountedDeletion = change.entries.some(entry =>
      entry.deletion && entry.path.endsWith('.rip') && mounted.has(entry.path));
    if (ordinaryReload || mountedDeletion) {
      program.sources(activeSources());
      return 'reload';
    }

    let transaction = null;
    let committed = false;
    try {
      transaction = workspace.stage(change.from, { hash: change.hash, sources: nextSources, compiled: nextCompiled }, changedRip);
      const verdict = applyPaths.length ? await apply.absorb(applyPaths, transaction.components) : 'ignore';
      transaction.commit();
      committed = true;
      for (const entry of change.entries) {
        if (entry.path.endsWith('.css')) refreshCss(entry.path, change.hash);
      }
      if (verdict === 'reload') {
        report('[Rip] committed App update requires a document reload');
        return 'reload';
      }
      return true;
    } catch (error) {
      if (transaction && !committed) transaction.rollback();
      program.sources(activeSources());
      report('[Rip] changed Rip program failed to activate:', error);
      return 'rejected';
    }
  };

  const watch = opts.watch === true || opts.feed != null;
  if (watch) {
    const latestUrl = opts.latestUrl ?? opts.feed?.latestUrl ?? (opts.url ? sibling(opts.url, 'latest.json') : '/latest.json');
    feed = app.connectFeed({ hash: () => workspace.hash(), apply: applyChange, reload }, {
      ...(opts.feed ?? {}),
      latestUrl,
      report,
    });
  }

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    feed?.close();
    current.destroy();
    program.dispose();
  };
  const stable = { workspace, feed, destroy };
  return Object.assign(handle, current, stable);
}
