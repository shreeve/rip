import { compile as compileTailwind } from 'tailwindcss';
import { parse } from 'css-tree';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tailwindDir = dirname(fileURLToPath(import.meta.resolve('tailwindcss/package.json')));
const stylesheets = {
  tailwindcss: readFileSync(join(tailwindDir, 'index.css'), 'utf8'),
  'tailwindcss/preflight.css': readFileSync(join(tailwindDir, 'preflight.css'), 'utf8'),
  'tailwindcss/theme.css': readFileSync(join(tailwindDir, 'theme.css'), 'utf8'),
  'tailwindcss/utilities.css': readFileSync(join(tailwindDir, 'utilities.css'), 'utf8'),
};

async function createCompiler(config = {}) {
  const source = `
@layer theme, base, components, utilities;
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@config;
`;

  return compileTailwind(source, {
    async loadModule(id, base, resourceHint) {
      if (resourceHint === 'config') return { path: id, base, module: config };
      throw new Error(`unsupported Tailwind resource hint: ${resourceHint}`);
    },
    polyfills: 0,
    async loadStylesheet(id, base) {
      const content = stylesheets[id];
      if (!content) throw new Error(`unsupported Tailwind stylesheet: ${id}`);
      return { base, path: id, content };
    },
  });
}

const identityKeys = new WeakMap();
const symbolKeys = new Map();
let nextIdentityKey = 1;

function identityKey(value) {
  const store = typeof value === 'symbol' ? symbolKeys : identityKeys;
  if (!store.has(value)) store.set(value, nextIdentityKey++);
  return store.get(value);
}

function stableSerialize(value, seen = new WeakSet()) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return JSON.stringify(value);
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
  if (type === 'undefined') return 'undefined';
  if (type === 'symbol') return `[Symbol:${identityKey(value)}]`;
  if (type === 'function') return `[Function:${identityKey(value)}]`;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry, seen)).join(',')}]`;
  }
  if (type === 'object') {
    if (seen.has(value)) return `[Circular:${identityKey(value)}]`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return `[${value.constructor?.name ?? 'Object'}:${identityKey(value)}]`;
    }
    seen.add(value);
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`);
    seen.delete(value);
    return `{${entries.join(',')}}`;
  }
  return String(value);
}

export function configCacheKey(config = {}) {
  return stableSerialize(config);
}

const compilerCache = new Map();
const compilerPromises = new Map();
compilerCache.set(configCacheKey({}), await createCompiler({}));

export async function prepareConfig(config = {}) {
  const key = configCacheKey(config);
  if (compilerCache.has(key)) return compilerCache.get(key);
  if (compilerPromises.has(key)) return compilerPromises.get(key);

  const pending = createCompiler(config).then((compiler) => {
    compilerCache.set(key, compiler);
    compilerPromises.delete(key);
    return compiler;
  });
  compilerPromises.set(key, pending);
  return pending;
}

export function compile(classes = [], config = {}) {
  const compiler = compilerCache.get(configCacheKey(config));
  if (!compiler) {
    throw new Error(
      'Tailwind config is not prepared for synchronous rendering; call prepareConfig(config) before rendering',
    );
  }
  const css = compiler.build(classes);
  return { css, styleSheet: parse(css) };
}
