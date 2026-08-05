// Browser publication consumer. Rip Server publishes {hash,list}; this layer
// validates and compiles that complete Rip program, launches App from prepared
// state, and optionally applies ordered watch changes. HTTP caching remains the
// browser's job—boot does not keep its own ETag/body cache.
import { createModuleLoader } from './browser-modules.js';
import { app, embeddedPackages } from './browser-app.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validHash = value => typeof value === 'string' && /^[A-Za-z0-9_]{6}$/.test(value);

const validPath = (path, ripOnly = false) => {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\\')) return false;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) return false;
  if (ripOnly && !path.endsWith('.rip')) return false;
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

const stageProgram = async (sources, debug) => {
  const files = new Map(Object.entries(sources));
  const staged = new Map();
  const registry = {
    read: path => files.get(path),
    exists: path => files.has(path),
    getCompiled: path => staged.get(path),
    setCompiled: (path, module) => void staged.set(path, module),
  };
  const loader = createModuleLoader({ components: registry, embeddedPackages, debug });
  const compiled = {};
  for (const path of Object.keys(sources)) {
    if (!path.startsWith('@rip-lang/')) compiled[path] = { ...(await loader.import(path)) };
  }
  return compiled;
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
  const compiled = await stageProgram(sources, debug);

  const workspace = app.createWorkspace();
  workspace.activate({ hash: bundle.hash, sources, compiled });

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

  let current = launchWith(compiled);
  let feed = null;
  let destroyed = false;
  const handle = {};
  const report = opts.feed?.report ?? ((...args) => console.error(...args));
  const reload = reason => {
    report(`[Rip] reloading${reason ? ` — ${reason}` : ''}`);
    if (typeof opts.reload === 'function') opts.reload(reason);
    else if (typeof location !== 'undefined') location.reload();
  };

  const cssLinkFor = path => {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (link.getAttribute('data-rip-css') === path) return link;
    }
    const base = path.slice(path.lastIndexOf('/') + 1);
    for (const link of document.querySelectorAll('link[rel="stylesheet"][href]')) {
      const href = link.getAttribute('href') || '';
      const clean = href.split('?')[0];
      if (clean === `/${path}` || clean.endsWith(`/${path}`) || clean === path || clean.endsWith(`/${base}`)) return link;
    }
    return null;
  };

  const refreshCss = (path, hash) => {
    const link = cssLinkFor(path);
    if (!link) return;
    const clean = (link.getAttribute('href') || link.href).split('?')[0];
    link.setAttribute('href', `${clean}?hash=${encodeURIComponent(hash)}`);
    link.disabled = false;
  };

  const launchCurrent = modules => {
    current.destroy();
    current = launchWith(modules);
    Object.assign(handle, current, stable);
  };

  const apply = app.createApply({
    renderer: { remountDirty: paths => current.renderer.remountDirty(paths) },
    escape: async () => launchCurrent(Object.fromEntries(
      workspace.listAll().flatMap(path => {
        const module = workspace.getCompiled(path);
        return module === undefined ? [] : [[path, module]];
      }),
    )),
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
      return false;
    }
    if (workspace.hash() === change.hash) return true;
    if (workspace.hash() !== change.from) return false;

    // CSS can refresh through normal HTTP. Every other ordinary asset and
    // every ordinary-asset deletion needs a full page reload.
    for (const entry of change.entries) {
      if (entry.path.endsWith('.rip')) continue;
      if (!entry.path.endsWith('.css') || entry.deletion) return false;
    }

    const nextSources = Object.fromEntries(workspace.listAll().map(path => [path, workspace.read(path)]));
    const changedRip = [];
    for (const entry of change.entries) {
      if (!entry.path.endsWith('.rip')) continue;
      changedRip.push(entry.path);
      if (entry.deletion) delete nextSources[entry.path];
      else nextSources[entry.path] = entry.source;
    }

    let nextCompiled;
    try {
      nextCompiled = await stageProgram(nextSources, debug);
    } catch (error) {
      report('[Rip] changed Rip program failed to compile:', error);
      return false;
    }

    try {
      workspace.commit(change.from, { hash: change.hash, sources: nextSources, compiled: nextCompiled }, changedRip);
      for (const entry of change.entries) {
        if (entry.path.endsWith('.css')) refreshCss(entry.path, change.hash);
      }
      if (changedRip.length) await apply.absorb(changedRip);
      Object.assign(handle, current, stable);
      return true;
    } catch (error) {
      report('[Rip] changed Rip program failed to activate:', error);
      return false;
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
  };
  const stable = { workspace, feed, destroy };
  return Object.assign(handle, current, stable);
}
