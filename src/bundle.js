// Bundle assembly — the server-side half of the browser package
// graph. An application's modules plus every browser-safe package they
// reach become one JSON bundle: `modules` maps store paths to sources
// and `packages` maps bare names to their `@rip-lang/<name>/` roots
// (the same spelling authors import — store paths are not a second
// vocabulary). A package travels only when its manifest declares
// `rip.browser`;
// a server-only or unknown import rejects assembly loudly, naming the
// importer. Discovery compiles each module and follows the emitter's
// RECORDED import spans — generated text is never scanned.
//
// Cross-boundary schema projections: a client module may import named
// bindings from a server-only `.rip` outside the app tree (the v3 cart
// pattern `import { UserPublic as User } from '../api/models.rip'`).
// With `moduleFiles` + `appDir`, extractClientProjections overlays the
// shippable shapes at the natural store path (`api/models.rip`) — the
// author's relative specifier is unchanged; the browser loader resolves
// it through the hidden physical App mount. :model / behavior refuse loudly.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { compile } from './compile.js';
import { extractClientProjections } from './extract-projections.js';

const RUNTIME_RE = /(?:^|\/)src\/runtime\/(intrinsics|stdlib|schema|reactive|components)\.js$/;

const unquote = specifier => specifier.slice(1, -1);

// Runnable package verbs (the packages/AGENTS.md contract: root-level
// test.rip / demo.rip / bench.rip) are dev files, never importable
// surface — they and the dev-only directories stay out of the bundle.
const VERB_FILES = new Set(['test.rip', 'demo.rip', 'bench.rip']);
const SKIP_DIRS = new Set(['node_modules', 'test', 'bench']);

const ripFilesUnder = dir => {
  const out = [];
  const walk = (at, depth) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith('.rip') && !(depth === 0 && VERB_FILES.has(entry.name))) out.push(full);
    }
  };
  walk(dir, 0);
  return out;
};

// Relative `.rip` import/re-export statements — the only edges that can
// leave the app tree. Fresh regex per call so matchAll's lastIndex
// never leaks. Captures the binding clause (group 1) and specifier
// (group 2); re-exports are the idiomatic projection form.
const RIP_REL_IMPORT = () =>
  /(?:^|\n)[ \t]*(?:import|export)\s+(?:([\s\S]*?)\s+from\s+)?['"](\.[^'"]*\.rip)['"]/g;

// Exported names in `{ a, b as c }` — left of any `as`. Local aliases
// stay on the importer; the synthetic module re-exports the source names.
const importedBindingNames = (clause) => {
  if (!clause) return [];
  const m = clause.match(/\{([^}]*)\}/);
  if (!m) return [];
  const names = [];
  for (const n of m[1].split(',')) {
    const t = n.trim();
    if (!t) continue;
    names.push(t.split(/\s+as\s+/)[0].trim());
  }
  return names;
};

// Overlay shippable projections at the project-relative path of the
// server file (`api/models.rip`). Importers keep `from '../api/models.rip'`;
// the loader's hidden-mount resolution lands on that key. Mutates `modules`
// in place.
const materializeSharedSchemas = (modules, moduleFiles, appDir) => {
  const absToStore = new Map();
  for (const [store, abs] of Object.entries(moduleFiles)) {
    absToStore.set(resolve(abs), store);
  }
  const insideBundle = (abs) => absToStore.has(resolve(abs));

  // target abs → { key, names:Set }
  const needs = new Map();
  // store key → abs — two server files collapsing to one key refuse.
  const overlayKeys = new Map();

  for (const [key, src] of Object.entries(modules)) {
    const file = moduleFiles[key];
    if (!file) continue;
    const fileDir = dirname(file);
    for (const m of src.matchAll(RIP_REL_IMPORT())) {
      const clause = m[1];
      const spec = m[2];
      const abs = resolve(fileDir, spec);
      if (!existsSync(abs)) continue;
      if (insideBundle(abs)) continue;
      const names = importedBindingNames(clause);
      if (names.length === 0) {
        throw new Error(
          `rip: cannot import server-only module '${spec}' into browser code (${key}). ` +
          'Only named schema projections can cross the client boundary.',
        );
      }
      let entry = needs.get(abs);
      if (!entry) {
        const overlayKey = relative(appDir, abs).replace(/\\/g, '/');
        if (!overlayKey || overlayKey.startsWith('../') || overlayKey.startsWith('/')) {
          throw new Error(
            `rip: cannot materialize '${abs}' into the browser bundle — ` +
            'the server file must sit under the app project root',
          );
        }
        if (modules[overlayKey] != null) {
          throw new Error(
            `rip: projection overlay '${overlayKey}' collides with a bundle module`,
          );
        }
        const prior = overlayKeys.get(overlayKey);
        if (prior && prior !== abs) {
          throw new Error(
            `rip: projection key collision: '${abs}' and '${prior}' both map to '${overlayKey}'. ` +
            "Two server-only modules can't materialize to the same browser-bundle key.",
          );
        }
        overlayKeys.set(overlayKey, abs);
        entry = { key: overlayKey, names: new Set() };
        needs.set(abs, entry);
      }
      for (const n of names) entry.names.add(n);
    }
  }

  for (const [abs, entry] of needs) {
    const targetSrc = readFileSync(abs, 'utf8');
    const result = extractClientProjections(targetSrc, [...entry.names], {
      path: entry.key,
    });
    if (!result.ok) {
      throw new Error(`rip: cannot ship schema import to the browser bundle: ${result.error}`);
    }
    modules[entry.key] = result.source;
  }
};

export function assembleBundle({ modules, packagesDir, data = null, moduleFiles = null, appDir = null } = {}) {
  if (!modules || typeof modules !== 'object') {
    throw new TypeError('rip: assembleBundle requires a modules object');
  }
  const bundle = { modules: { ...modules }, packages: {} };
  if (data) bundle.data = data;

  if (moduleFiles && appDir) {
    materializeSharedSchemas(bundle.modules, moduleFiles, appDir);
  }

  const claimPackage = (name, importer) => {
    if (bundle.packages[name]) return;
    const short = name.replace(/^@rip-lang\//, '');
    const root = packagesDir ? join(packagesDir, short) : null;
    if (!root || !existsSync(join(root, 'package.json'))) {
      throw new Error(`rip: '${importer}' imports '${name}', which is not a known package`);
    }
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (manifest?.rip?.browser !== true) {
      throw new Error(
        `rip: '${importer}' imports '${name}', which does not declare browser safety — ` +
        'a package travels to the browser only with "rip": { "browser": true }',
      );
    }
    const entryFor = value => (typeof value === 'string' ? value : value?.default) ?? null;
    const entryTarget = entryFor(manifest.exports?.['.']) ?? 'index.rip';
    const exportsMap = {};
    for (const [key, value] of Object.entries(manifest.exports ?? {})) {
      if (key === '.') continue;
      const target = entryFor(value);
      if (target?.endsWith('.rip')) exportsMap[key] = target.replace(/^\.\//, '');
    }
    bundle.packages[name] = {
      root: name,
      entry: entryTarget.replace(/^\.\//, ''),
      exports: exportsMap,
    };
    for (const file of ripFilesUnder(root)) {
      const relativePath = file.slice(root.length + 1);
      const key = `${name}/${relativePath}`;
      if (bundle.modules[key] != null) {
        throw new Error(`rip: App module '${key}' collides with browser package '${name}'`);
      }
      bundle.modules[key] = readFileSync(file, 'utf8');
    }
  };

  // The application package is the boot substrate: every bundle
  // carries it, imported or not — and the workspace rides inside it
  // (docs/WORKSPACE.md, Q9), so no second claim exists.
  if (packagesDir) claimPackage('@rip-lang/app', '<boot>');

  const queue = Object.keys(bundle.modules);
  const seen = new Set();
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const source = bundle.modules[path];
    let compiled;
    try {
      compiled = compile(source, { path, runtimeDelivery: 'none' });
    } catch (error) {
      const framed = new Error(`rip: '${path}' failed to compile during bundle assembly: ${error.message}`);
      framed.cause = error;
      throw framed;
    }
    if (compiled.runtimes?.has?.('schema-orm')) {
      throw new Error(
        `rip: '${path}' declares a :model schema — persistence is server-only and cannot travel to the browser`,
      );
    }
    for (const span of compiled.imports) {
      const spec = unquote(span.specifier);
      if (RUNTIME_RE.test(spec)) continue;
      // Relative imports and already-claimed package store paths
      // (`@rip-lang/app/feed.rip`) need no further package claim.
      if (spec.startsWith('./') || spec.startsWith('../') || bundle.modules[spec]) continue;
      const bare = spec.match(/^(@rip-lang\/[\w-]+)(?:\/.+)?$/);
      if (!bare) {
        throw new Error(
          `rip: '${path}' imports '${spec}', which cannot travel to the browser — ` +
          'server-only and unknown modules stay on the server',
        );
      }
      claimPackage(bare[1], path);
      for (const added of Object.keys(bundle.modules)) {
        if (!seen.has(added)) queue.push(added);
      }
    }
  }

  return bundle;
}
