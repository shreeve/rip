// The browser entry: compiler surface, one copy of every browser-safe
// feature runtime, module/script loaders, App boot, and HMR overlay.
// Browser compilation delivers runtimes by SCOPE, not by injection —
// compiled scripts run with these bindings provided by their loader —
// so compile() uses runtimeDelivery 'none' here (or 'import' for ES
// modules), and the runtime modules' process-wide sentinels guarantee
// one copy per bundle. Server-only surfaces (loader, run harness,
// project config, persistence, migration, CLI) are structurally
// unreachable from this module; the bundle gate pins that.
//
// TypeScript face / declaration emission belong to CLI check and
// packages/vscode — never to the in-page compiler.

import { compile as compileSource } from './compile.js';
import * as intrinsics from './runtime/intrinsics.js';
import * as stdlib from './runtime/stdlib.js';
import * as schema from './runtime/schema.js';
import * as reactive from './runtime/reactive.js';
import * as components from './runtime/components.js';
import * as app from '../packages/app/index.rip';

const { __hmrEmit } = components;

// ---------------------------------------------------------------------------
// Compile seam — always Rip→JavaScript
// ---------------------------------------------------------------------------

export function compile(source, options = {}) {
  if (options.face === 'ts') {
    throw new Error('rip: TypeScript face is unavailable in the browser');
  }
  return compileSource(source, { ...options, face: 'js' });
}

// ---------------------------------------------------------------------------
// Runtimes — one frozen scope namespace (no ORM)
// ---------------------------------------------------------------------------

const RUNTIME_MODULES = { intrinsics, stdlib, schema, reactive, components };

export const runtimes = Object.freeze({
  ...intrinsics,
  ...stdlib,
  ...schema,
  ...reactive,
  ...components,
});

// ---------------------------------------------------------------------------
// Embedded App package
// ---------------------------------------------------------------------------

const rash = Object.freeze({ rash: app.rash, check: app.check });

export const embeddedPackages = Object.freeze({
  'rip/app': app,
  'rip/app/rash': rash,
});

export { app };

// ---------------------------------------------------------------------------
// Module graph loader
// ---------------------------------------------------------------------------

const RUNTIME_PATHS = new Map(Object.keys(RUNTIME_MODULES).map(
  name => [new URL(`./runtime/${name}.js`, import.meta.url).pathname, name],
));
const RUNTIME_RE = /(?:^|\/)src\/runtime\/(intrinsics|stdlib|schema|reactive|components)\.js$/;
const BRIDGE_KEY = '__ripModuleBridge';

const unquote = specifier => specifier.slice(1, -1);

const joinPath = (from, relative) => {
  const parts = from.split('/').slice(0, -1);
  for (const piece of relative.split('/')) {
    if (piece === '' || piece === '.') continue;
    if (piece === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(piece);
    }
  }
  return parts.join('/');
};

const toObjectUrl = code => {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob !== 'undefined') {
    return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }
  return `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`;
};

function createModuleLoaderImpl({
  components: registry,
  embeddedPackages = {},
  debug = false,
  hmr = false,
} = {}) {
  if (!registry || typeof registry.read !== 'function') {
    throw new TypeError('rip: createModuleLoader requires a component registry');
  }

  const urls = new Map();
  const namespaces = new Map();
  const bridges = new Map();
  const dependents = new Map();
  const dependencies = new Map();
  const retired = new Set();

  const revoke = url => {
    if (typeof url === 'string' && url.startsWith('blob:') && typeof URL?.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  };

  const collect = async () => {
    const pending = [...retired];
    retired.clear();
    await Promise.allSettled(pending.map(async promise => revoke(await promise)));
  };

  // The page's one runtime and embedded-package copies cross into generated
  // module space through named re-export bridges. The stable modules never
  // evaluate twice, while Blob modules can import them by ordinary ESM names.
  const bridgeFor = (key, namespace) => {
    if (bridges.has(key)) return bridges.get(key);
    globalThis[BRIDGE_KEY] ??= {};
    const existing = globalThis[BRIDGE_KEY][key];
    if (existing && existing !== namespace) {
      throw new Error(`rip: two copies of embedded module '${key}' are active on one page`);
    }
    globalThis[BRIDGE_KEY][key] = namespace;
    const lines = [`const ns = globalThis['${BRIDGE_KEY}'][${JSON.stringify(key)}];`];
    for (const name of Object.keys(namespace)) {
      if (name === 'default') {
        lines.push("export default ns['default'];");
      } else if (/^[A-Za-z_$][\w$]*$/.test(name)) {
        lines.push(`export const ${name} = ns[${JSON.stringify(name)}];`);
      } else {
        throw new Error(`rip: embedded module '${key}' exports '${name}', which cannot cross the module bridge`);
      }
    }
    const url = toObjectUrl(lines.join('\n'));
    bridges.set(key, url);
    return url;
  };

  const resolvePath = (specifier, from) => {
    const spec = unquote(specifier);
    const runtime = RUNTIME_PATHS.get(spec) ?? spec.match(RUNTIME_RE)?.[1];
    if (runtime) return { bridge: `runtime:${runtime}`, namespace: RUNTIME_MODULES[runtime] };
    const inBundle = path => {
      try {
        return registry.exists(path);
      } catch {
        return false;
      }
    };
    const hint = spec.endsWith('.rip') ? '' : ` — did you mean '${spec}.rip'?`;
    if (spec.startsWith('./') || spec.startsWith('../')) {
      const joined = joinPath(from, spec);
      if (joined && inBundle(joined)) return { path: joined };

      // App identities are relative to the public App root, while authored
      // imports are relative to their physical project path under app/. An
      // import that climbs out of that mount (for a shippable API schema
      // projection, for example) resolves against the hidden physical mount
      // without putting `app/` back into any bundle or Workspace identity.
      if (!from.startsWith('rip/')) {
        const physical = joinPath(`app/${from}`, spec);
        const mounted = physical?.startsWith('app/') ? physical.slice('app/'.length) : physical;
        if (mounted && inBundle(mounted)) return { path: mounted };
      }

      throw new Error(`rip: '${from}' imports '${spec}', which is not in the bundle${hint}`);
    }
    // Store paths use the author-facing package spelling. The publication
    // needs no separate resolver table: package roots and subpaths have one
    // canonical Rip filename convention.
    const bare = spec.match(/^rip\/([\w-]+)(?:\/(.+))?$/);
    if (bare) {
      if (inBundle(spec)) return { path: spec };
      const packageName = `rip/${bare[1]}`;
      const embedded = embeddedPackages[spec];
      if (embedded) return { bridge: `package:${spec}`, namespace: embedded };
      if (embeddedPackages[packageName]) {
        throw new Error(`rip: '${from}' imports '${spec}', which '${packageName}' does not export in the browser`);
      }
      const sub = bare[2]
        ? (bare[2].endsWith('.rip') ? bare[2] : `${bare[2]}.rip`)
        : 'index.rip';
      const path = `${packageName}/${sub}`;
      if (!inBundle(path)) {
        throw new Error(
          `rip: '${from}' imports '${spec}', but '${path}' is not in the bundle — ` +
          'only packages declaring browser safety travel to the browser',
        );
      }
      return { path };
    }
    throw new Error(
      `rip: '${from}' imports '${spec}', which is not loadable in a browser — ` +
      'server-only and unknown modules never travel to the browser',
    );
  };

  // Loads memoize their in-flight promise, so concurrent imports of a
  // shared dependency join one load instead of reading as a cycle; a
  // real cycle is an ancestor in the REQUESTING chain.
  const load = (path, chain) => {
    if (chain.includes(path)) {
      throw new Error(`rip: import cycle through '${path}' (${chain.join(' -> ')} -> ${path})`);
    }
    if (urls.has(path)) return urls.get(path);
    const promise = (async () => {
      const source = registry.read(path);
      if (source === undefined) {
        throw new Error(`rip: '${path}' is not in the bundle`);
      }
      const compiled = compile(source, {
        path,
        runtimeDelivery: 'import',
        browserModule: true,
        ...(hmr ? { hmr: true } : null),
      });
      let code = compiled.code;
      for (const span of [...compiled.imports].reverse()) {
        const target = resolvePath(span.specifier, path);
        if (target.path) {
          let importers = dependents.get(target.path);
          if (!importers) dependents.set(target.path, importers = new Set());
          importers.add(path);
          let imports = dependencies.get(path);
          if (!imports) dependencies.set(path, imports = new Set());
          imports.add(target.path);
        }
        const url = target.bridge
          ? bridgeFor(target.bridge, target.namespace)
          : await load(target.path, [...chain, path]);
        code = `${code.slice(0, span.start)}${JSON.stringify(url)}${code.slice(span.end)}`;
      }
      if (debug) {
        // compile()'s map precedes the splices: a spliced URL carries
        // no newline, so line positions — all a debugger needs — hold.
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(compiled.map))));
        code += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${b64}`;
      }
      return toObjectUrl(code);
    })();
    urls.set(path, promise);
    promise.catch(() => urls.delete(path));
    return promise;
  };

  return {
    async import(path) {
      if (namespaces.has(path)) return namespaces.get(path);
      const url = await load(path, []);
      const namespace = await import(url);
      namespaces.set(path, namespace);
      registry.setCompiled(path, { ...namespace });
      return namespace;
    },
    invalidate(path) {
      const queue = [path];
      const seen = new Set();
      while (queue.length) {
        const at = queue.pop();
        if (seen.has(at)) continue;
        seen.add(at);
        if (urls.has(at)) retired.add(urls.get(at));
        urls.delete(at);
        namespaces.delete(at);
        for (const importer of dependents.get(at) ?? []) queue.push(importer);
        dependents.delete(at);
        for (const dependency of dependencies.get(at) ?? []) {
          const importers = dependents.get(dependency);
          importers?.delete(at);
          if (importers?.size === 0) dependents.delete(dependency);
        }
        dependencies.delete(at);
      }
      return seen;
    },
    collect,
    dispose() {
      for (const promise of urls.values()) retired.add(promise);
      urls.clear();
      namespaces.clear();
      dependents.clear();
      dependencies.clear();
      for (const url of bridges.values()) revoke(url);
      bridges.clear();
      void collect();
    },
  };
}

// ---------------------------------------------------------------------------
// <script type="text/rip"> loading
// ---------------------------------------------------------------------------

// <script type="text/rip"> loading. Every script source on a page —
// data-src listed bundles, inline text, and src fetches — concatenates
// into ONE program compiled in script mode and run as one async
// closure, so the page's scripts genuinely share a scope: a later
// script reads earlier bindings, reactive state crosses directly, and
// re-spelling `name = value` assigns instead of colliding. Module
// forms reject at their own positions (script tags are not modules);
// the compiler owns that judgment, so string content that merely looks
// like a module form is never touched.
//
// The DOM, network, and eval seams arrive through an injectable host,
// so the loader tests under Node and the browser default is one small
// adapter. Failure posture: a script that fails to compile is reported
// with its own label and local position and DROPPED — the rest of the
// page recompiles and runs. A duplicate source rejects the load
// loudly. Evaluation requires eval capability: a CSP that blocks
// FUNCTION CONSTRUCTION produces one loud diagnostic naming the
// unsafe-eval requirement; an error thrown by running user code is the
// page's own and reports as such.

const scopeNames = Object.keys(runtimes);
const scopeValues = scopeNames.map(name => runtimes[name]);

const browserHost = () => {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
    throw new Error('rip: processRipScripts requires a browser or an injected host');
  }
  return {
    scripts() {
      return Array.from(document.querySelectorAll('script[type="text/rip"]')).map(node => ({
        src: node.getAttribute('src'),
        text: node.textContent ?? '',
      }));
    },
    async fetchText(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.text();
    },
    prepare(code, names) {
      return new Function(...names, code);
    },
    async ready() {
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      }
    },
    report(error) {
      // The diagnostic lives in the message TEXT: some consoles
      // (Firefox) render an Error argument as its class name alone.
      console.error('[Rip]', String(error));
    },
  };
};

// Strip the longest common indentation PREFIX so inline script bodies
// survive their markup's indentation. Prefixes compare as strings: a
// tab/space disagreement means there is no honest common indent, so
// nothing strips.
const dedent = text => {
  const lines = text.split('\n');
  let prefix = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const lead = line.match(/^[ \t]*/)[0];
    if (prefix === null) {
      prefix = lead;
      continue;
    }
    let shared = 0;
    while (shared < prefix.length && shared < lead.length && prefix[shared] === lead[shared]) shared += 1;
    prefix = prefix.slice(0, shared);
    if (!prefix) return text;
  }
  if (!prefix) return text;
  return lines.map(line => (line.trim() ? line.slice(prefix.length) : line)).join('\n');
};

// Duplicate claims compare resolved URLs, not spellings: '/a.rip' and
// './a.rip' are the same source. Query strings stay distinct — cache
// busting the same path twice is a deliberate act.
const claimKey = label => {
  try {
    return new URL(label, 'https://rip.invalid/').href;
  } catch {
    return label;
  }
};

export async function processRipScripts(host = null) {
  const h = host ?? browserHost();
  await h.ready?.();

  const sources = [];
  const seen = new Set();
  const claim = label => {
    const key = claimKey(label);
    if (seen.has(key)) {
      throw new Error(`rip: script source '${label}' is listed more than once`);
    }
    seen.add(key);
  };

  for (const url of h.dataSrc?.() ?? []) {
    claim(url);
    sources.push({ label: url, text: null, url });
  }
  let ordinal = 0;
  for (const script of h.scripts?.() ?? []) {
    ordinal += 1;
    if (script.src) {
      claim(script.src);
      sources.push({ label: script.src, text: null, url: script.src });
    } else {
      sources.push({ label: `<script:${ordinal}>`, text: dedent(script.text ?? '') });
    }
  }

  const failures = [];
  const report = (label, error) => {
    failures.push({ label, error });
    h.report?.(error);
  };

  const loaded = [];
  for (const source of sources) {
    if (source.text !== null) {
      loaded.push(source);
      continue;
    }
    if (typeof h.fetchText !== 'function') {
      throw new Error("rip: this host loads script sources by URL but provides no fetchText");
    }
    try {
      loaded.push({ ...source, text: await h.fetchText(source.url) });
    } catch (error) {
      report(source.label, new Error(`rip: failed to load '${source.label}': ${error.message}`));
    }
  }

  // One program: concatenated sources with recorded line offsets, so a
  // compile error maps back to its own script and local line. The
  // failing script drops and the rest recompile — a page never dies
  // for one bad tag.
  let active = loaded;
  let compiled = null;
  while (active.length) {
    const offsets = [];
    let line = 1;
    const parts = [];
    for (const source of active) {
      offsets.push({ source, start: line });
      const text = source.text.endsWith('\n') ? source.text.slice(0, -1) : source.text;
      parts.push(text);
      line += text.split('\n').length;
    }
    try {
      compiled = compile(parts.join('\n'), { path: '<scripts>', runtimeDelivery: 'none', script: true });
      break;
    } catch (error) {
      let owner = offsets[0];
      for (const entry of offsets) {
        if (typeof error.line === 'number' && entry.start <= error.line) owner = entry;
      }
      const local = typeof error.line === 'number' ? error.line - owner.start + 1 : null;
      const framed = new Error(
        `rip: ${owner.source.label}${local ? `:${local}` : ''} failed to compile: ${error.message}`,
      );
      framed.cause = error;
      framed.line = local;
      framed.col = error.col;
      report(owner.source.label, framed);
      active = active.filter(source => source !== owner.source);
      compiled = null;
    }
  }

  let executed = false;
  if (compiled) {
    const program = `'use strict';\nreturn (async () => {\n${compiled.code}\n})();`;
    let fn = null;
    try {
      fn = h.prepare(program, scopeNames);
    } catch (error) {
      const csp = new Error(
        "rip: script evaluation is blocked by Content Security Policy — running Rip from script tags requires 'unsafe-eval' " +
        '(script-src). Serve precompiled JavaScript or relax the policy for this page.',
      );
      csp.cause = error;
      report('<evaluate>', csp);
    }
    if (fn) {
      try {
        await fn(...scopeValues);
        executed = true;
      } catch (error) {
        // The page's own code threw: report it as the page's error —
        // scripts after the throwing statement never ran.
        report('<runtime>', error);
      }
    }
  }

  return { count: active.length, executed, failures };
}

// ---------------------------------------------------------------------------
// HMR failure overlay
// ---------------------------------------------------------------------------

const ATTR = 'data-rip-hmr-overlay';

let overlayEl = null;

const failureText = error => {
  if (error == null) return 'Unknown update failure';
  if (typeof error === 'string') return error;
  return error.message || error.stack || String(error);
};

const failurePath = error => {
  if (error == null || typeof error !== 'object') return null;
  if (typeof error.path === 'string' && error.path) return error.path;
  if (typeof error.file === 'string' && error.file) return error.file;
  return null;
};

export function showHmrOverlay(kind, error) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const root = document.body || document.documentElement;
  if (!root) return null;

  clearHmrOverlay();

  const card = document.createElement('div');
  card.setAttribute(ATTR, kind || 'compile');
  card.setAttribute('role', 'alert');
  card.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483646',
    'display:flex',
    'align-items:flex-start',
    'justify-content:center',
    'padding:2rem 1rem',
    'box-sizing:border-box',
    'background:rgba(15,23,42,0.45)',
    'overflow:auto',
  ].join(';');

  const shell = document.createElement('div');
  shell.style.cssText = 'position:relative;max-width:52rem;width:100%';

  const panel = document.createElement('pre');
  panel.style.cssText = [
    'margin:0',
    'padding:1rem 1.25rem',
    'color:#b91c1c',
    'background:#fef2f2',
    'border:1px solid #fecaca',
    'border-radius:8px',
    'font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
    'white-space:pre-wrap',
    'overflow-wrap:anywhere',
  ].join(';');

  const title = kind === 'activate'
    ? 'Rip: update failed to activate'
    : 'Rip: update failed to compile';
  const path = failurePath(error);
  const header = path ? `${title}\n${path}\n\n` : `${title}\n\n`;
  panel.textContent = header + failureText(error);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.style.cssText = [
    'position:absolute',
    'top:0.5rem',
    'right:0.5rem',
    'padding:0.4rem 0.75rem',
    'font:12px/1.2 system-ui,sans-serif',
    'color:#0f172a',
    'background:#fff',
    'border:1px solid #cbd5e1',
    'border-radius:6px',
    'cursor:pointer',
  ].join(';');
  dismiss.addEventListener('click', () => clearHmrOverlay());

  shell.appendChild(panel);
  shell.appendChild(dismiss);
  card.appendChild(shell);
  card.addEventListener('click', event => {
    if (event.target === card) clearHmrOverlay();
  });

  const onKey = event => {
    if (event.key === 'Escape') clearHmrOverlay();
  };
  card._ripOnKey = onKey;
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onKey);
  }

  root.appendChild(card);
  overlayEl = card;
  __hmrEmit('reject', {
    kind: kind || 'compile',
    path: failurePath(error),
    message: failureText(error).slice(0, 500),
  });
  return card;
}

export function clearHmrOverlay() {
  if (!overlayEl) return;
  const onKey = overlayEl._ripOnKey;
  if (
    onKey &&
    typeof document !== 'undefined' &&
    typeof document.removeEventListener === 'function'
  ) {
    document.removeEventListener('keydown', onKey);
  }
  overlayEl.remove?.();
  overlayEl = null;
}

export function hmrOverlayElement() {
  return overlayEl;
}

// ---------------------------------------------------------------------------
// Publication consumer / boot / HMR apply
// ---------------------------------------------------------------------------

// Browser publication consumer. Rip Sites publishes {hash,list}; this layer
// validates and compiles that complete Rip program, launches App from prepared
// state, and optionally applies ordered watch changes. HTTP caching remains the
// browser's job—boot does not keep its own ETag/body cache.
const { validatePrepared } = app;

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
    if (entry[0] === 'rip/app' || entry[0].startsWith('rip/app/')) {
      throw new Error(`rip: bundle source '${entry[0]}' collides with embedded package 'rip/app'`);
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

const createProgram = (initialSources, debug, { hmr = false } = {}) => {
  let files = new Map(Object.entries(initialSources));
  const staged = new Map();
  const registry = {
    read: path => files.get(path),
    exists: path => files.has(path),
    getCompiled: path => staged.get(path),
    setCompiled: (path, module) => void staged.set(path, module),
  };
  const loader = createModuleLoaderImpl({ components: registry, embeddedPackages, debug, hmr });
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
          if (!path.startsWith('rip/')) compiled[path] = { ...(await loader.import(path)) };
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
  const watch = opts.watch === true || opts.feed != null;
  const program = createProgram(sources, debug, { hmr: watch });
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
    clearHmrOverlay();
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
    report,
  });

  // Candidate App hashes that failed compile/activation. Manager may still
  // advance its chain through them; recovery rebases onto the living LKG.
  const rejected = new Set();

  const applyChange = async wire => {
    let change;
    try {
      change = parseChange(wire);
    } catch (error) {
      report('[Rip] malformed publication change:', error);
      return 'reload';
    }
    // Same final hash as the living App: ignore as a duplicate, but still
    // clear quarantine/overlay when Manager walks back to LKG after a
    // rejected candidate (restore of identical good source).
    if (workspace.hash() === change.hash) {
      rejected.clear();
      clearHmrOverlay();
      return true;
    }
    if (rejected.has(change.hash)) return true;

    let stageFrom = change.from;
    if (workspace.hash() !== change.from) {
      if (rejected.has(change.from)) stageFrom = workspace.hash();
      else return 'reload';
    }

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
      applyPaths = staged.invalidated.filter(path => !path.startsWith('rip/'));
      validatePrepared({ compiled: nextCompiled, data: dataFor(nextCompiled) });
    } catch (error) {
      program.sources(activeSources());
      rejected.add(change.hash);
      report('[Rip] changed Rip program failed to compile:', error);
      showHmrOverlay('compile', error);
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
      transaction = workspace.stage(stageFrom, { hash: change.hash, sources: nextSources, compiled: nextCompiled }, changedRip);
      const verdict = applyPaths.length ? await apply.absorb(applyPaths, transaction.components) : 'ignore';
      transaction.commit();
      committed = true;
      rejected.clear();
      for (const entry of change.entries) {
        if (entry.path.endsWith('.css')) refreshCss(entry.path, change.hash);
      }
      clearHmrOverlay();
      if (verdict === 'reload') {
        report('[Rip] committed App update requires a document reload');
        return 'reload';
      }
      return true;
    } catch (error) {
      if (transaction && !committed) transaction.rollback();
      program.sources(activeSources());
      rejected.add(change.hash);
      report('[Rip] changed Rip program failed to activate:', error);
      showHmrOverlay('activate', error);
      return 'rejected';
    }
  };

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
    clearHmrOverlay();
    feed?.close();
    current.destroy();
    program.dispose();
  };
  const stable = { workspace, feed, destroy };
  return Object.assign(handle, current, stable);
}

// ---------------------------------------------------------------------------
// Public browser API
// ---------------------------------------------------------------------------

export function createModuleLoader(options = {}) {
  return createModuleLoaderImpl({
    ...options,
    embeddedPackages: { ...embeddedPackages, ...options.embeddedPackages },
  });
}

// The compiler call browser loaders make: JavaScript out, runtimes by
// scope, original-position diagnostics carried on the thrown error.
// Browser compilation delivers runtimes by scope, never by emission,
// so another delivery mode rejects by name.
export function compileToJS(source, options = {}) {
  if (options.runtimeDelivery !== undefined && options.runtimeDelivery !== 'none') {
    throw new Error(
      `rip: browser compilation delivers runtimes by scope; runtimeDelivery '${options.runtimeDelivery}' is not available here`,
    );
  }
  return compile(source, { ...options, runtimeDelivery: 'none' });
}
