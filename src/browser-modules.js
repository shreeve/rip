// The browser module graph. Bundle modules are real ES modules:
// each compiles on demand, its emitted import specifiers — recorded by
// the emitter at emission, never scanned out of generated text —
// splice to the resolved form, and the module loads through an object
// URL. Resolution order for a specifier:
//
//   './x.rip', '../y.rip'   another bundle module, relative to here
//                           (including project-root projection overlays)
//   '@rip-lang/app[/rash]'  the App package embedded in rip.js
//   '@rip-lang/<name>/…'    a bundled non-core package module. Package roots
//                           resolve to index.rip; subpaths resolve to .rip.
//   …/runtime/<m>.js        the page's ONE runtime copy, through a
//                           bridge module — never a second evaluation;
//                           matched by the emitter's own delivery
//                           pathname or the …/src/runtime/… spelling
//
// Anything else is server-only or unknown and rejects loudly, naming
// the module that asked. Cycles and dynamic imports reject during
// compilation. invalidate() forgets a module's compilation AND every
// importer that reached it, transitively: an importer's code splices
// its dependency's URL, so an importer left cached would keep running
// the OLD dependency. Finer-grained propagation belongs to hot
// replacement.
//
// `debug` appends an inline source map to every compiled module, so
// devtools show the .rip source. Off by default: maps are a
// development affordance and never ship in production boots.
import { compile } from './compile.js';
import * as intrinsics from './runtime/intrinsics.js';
import * as stdlib from './runtime/stdlib.js';
import * as schema from './runtime/schema.js';
import * as reactive from './runtime/reactive.js';
import * as components from './runtime/components.js';

const RUNTIME_MODULES = { intrinsics, stdlib, schema, reactive, components };
// Runtime imports arrive in two spellings. The emitter's delivery
// imports spell each runtime as './runtime/<m>.js' resolved against
// its own module URL — and this module always travels WITH the
// emitter (side by side in src/ under Node, one concatenated file in
// the browser bundle), so resolving the same relative path here
// reproduces the emitter's spelling exactly, wherever the build put
// it. Package sources spell the repository path (…/src/runtime/…).
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

export function createModuleLoader({
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
      if (!from.startsWith('@rip-lang/')) {
        const physical = joinPath(`app/${from}`, spec);
        const mounted = physical?.startsWith('app/') ? physical.slice('app/'.length) : physical;
        if (mounted && inBundle(mounted)) return { path: mounted };
      }

      throw new Error(`rip: '${from}' imports '${spec}', which is not in the bundle${hint}`);
    }
    // Store paths use the author-facing package spelling. The publication
    // needs no separate resolver table: package roots and subpaths have one
    // canonical Rip filename convention.
    const bare = spec.match(/^@rip-lang\/([\w-]+)(?:\/(.+))?$/);
    if (bare) {
      if (inBundle(spec)) return { path: spec };
      const packageName = `@rip-lang/${bare[1]}`;
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
