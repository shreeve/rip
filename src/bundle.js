// Bundle assembly — the server-side half of the browser package
// graph. An application's modules plus every browser-safe package they
// reach become one JSON bundle: `modules` maps store paths to sources
// and `packages` maps bare names to their `_pkg/<name>/` roots. A
// package travels only when its manifest declares `rip.browser`;
// a server-only or unknown import rejects assembly loudly, naming the
// importer. Discovery compiles each module and follows the emitter's
// RECORDED import spans — generated text is never scanned.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from './compile.js';

const RUNTIME_RE = /(?:^|\/)src\/runtime\/(intrinsics|stdlib|schema|reactive|components)\.js$/;

const unquote = specifier => specifier.slice(1, -1);

const ripFilesUnder = dir => {
  const out = [];
  const walk = at => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'test') continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.rip')) out.push(full);
    }
  };
  walk(dir);
  return out;
};

export function assembleBundle({ modules, packagesDir, data = null }) {
  if (!modules || typeof modules !== 'object') {
    throw new TypeError('rip: assembleBundle requires a modules object');
  }
  const bundle = { modules: { ...modules }, packages: {} };
  if (data) bundle.data = data;

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
      root: `_pkg/${short}`,
      entry: entryTarget.replace(/^\.\//, ''),
      exports: exportsMap,
    };
    for (const file of ripFilesUnder(root)) {
      const relative = file.slice(root.length + 1);
      bundle.modules[`_pkg/${short}/${relative}`] = readFileSync(file, 'utf8');
    }
  };

  // The application package is the boot substrate: every bundle
  // carries it, imported or not.
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
      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('_pkg/')) continue;
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
