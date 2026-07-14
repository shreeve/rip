// The browser module graph. Bundle modules are real ES modules:
// each compiles on demand, its emitted import specifiers — recorded by
// the emitter at emission, never scanned out of generated text —
// splice to the resolved form, and the module loads through an object
// URL. Resolution order for a specifier:
//
//   './x.rip', '../y.rip'   another bundle module, relative to here
//   '_pkg/<name>/…'         a bundled package module, absolute
//   '@rip-lang/<name>[/…]'  a bundled package entry from the packages
//                           table — only packages the bundle carries
//   …/src/runtime/<m>.js    the page's ONE runtime copy, through a
//                           bridge module — never a second evaluation
//
// Anything else is server-only or unknown and rejects loudly, naming
// the module that asked. Cycles reject with the requesting chain.
// Dynamic import() specifiers are expressions and stay unrewritten —
// inside an object-URL module they fail with the browser's own
// resolution error. invalidate() forgets one module's compilation;
// dependent-graph invalidation belongs to hot replacement.
import { compile } from './compile.js';
import * as intrinsics from './runtime/intrinsics.js';
import * as stdlib from './runtime/stdlib.js';
import * as schema from './runtime/schema.js';
import * as reactive from './runtime/reactive.js';
import * as components from './runtime/components.js';

const RUNTIME_MODULES = { intrinsics, stdlib, schema, reactive, components };
const RUNTIME_RE = /(?:^|\/)src\/runtime\/(intrinsics|stdlib|schema|reactive|components)\.js$/;
const BRIDGE_KEY = '__ripRuntimeBridge';

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

export function createModuleLoader({ components: registry, packages = {} } = {}) {
  if (!registry || typeof registry.read !== 'function') {
    throw new TypeError('rip: createModuleLoader requires a component registry');
  }

  const urls = new Map();
  const namespaces = new Map();
  const bridges = new Map();

  // The page's one runtime copy crosses into module space through a
  // generated bridge: named re-exports reading a global handle, so the
  // runtime module itself never evaluates twice.
  const bridgeFor = name => {
    if (bridges.has(name)) return bridges.get(name);
    const namespace = RUNTIME_MODULES[name];
    globalThis[BRIDGE_KEY] ??= {};
    const existing = globalThis[BRIDGE_KEY][name];
    if (existing && existing !== namespace) {
      throw new Error(`rip: two copies of the Rip runtime are bridging '${name}' on one page`);
    }
    globalThis[BRIDGE_KEY][name] = namespace;
    const lines = [`const ns = globalThis['${BRIDGE_KEY}']['${name}'];`];
    for (const key of Object.keys(namespace)) {
      if (!/^[A-Za-z_$][\w$]*$/.test(key)) {
        throw new Error(`rip: runtime '${name}' exports '${key}', which cannot cross the module bridge`);
      }
      lines.push(`export const ${key} = ns['${key}'];`);
    }
    const url = toObjectUrl(lines.join('\n'));
    bridges.set(name, url);
    return url;
  };

  const resolvePath = (specifier, from) => {
    const spec = unquote(specifier);
    const runtime = spec.match(RUNTIME_RE);
    if (runtime) return { bridge: runtime[1] };
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
      if (!joined || !inBundle(joined)) {
        throw new Error(`rip: '${from}' imports '${spec}', which is not in the bundle${hint}`);
      }
      return { path: joined };
    }
    if (spec.startsWith('_pkg/')) {
      if (!inBundle(spec)) {
        throw new Error(`rip: '${from}' imports '${spec}', which is not in the bundle${hint}`);
      }
      return { path: spec };
    }
    const bare = spec.match(/^@rip-lang\/([\w-]+)(?:\/(.+))?$/);
    if (bare) {
      const entry = packages[`@rip-lang/${bare[1]}`];
      if (!entry) {
        throw new Error(
          `rip: '${from}' imports '${spec}', but the bundle carries no such package — ` +
          'only packages declaring browser safety travel to the browser',
        );
      }
      const sub = bare[2]
        ? entry.exports?.[`./${bare[2]}`] ?? (bare[2].endsWith('.rip') ? bare[2] : `${bare[2]}.rip`)
        : entry.entry;
      const path = `${entry.root}/${sub}`;
      if (!inBundle(path)) {
        throw new Error(`rip: '${from}' imports '${spec}', but '${path}' is not in the bundle`);
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
      const compiled = compile(source, { path, runtimeDelivery: 'import' });
      let code = compiled.code;
      for (const span of [...compiled.imports].reverse()) {
        const target = resolvePath(span.specifier, path);
        const url = target.bridge ? bridgeFor(target.bridge) : await load(target.path, [...chain, path]);
        code = `${code.slice(0, span.start)}${JSON.stringify(url)}${code.slice(span.end)}`;
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
      urls.delete(path);
      namespaces.delete(path);
    },
  };
}
