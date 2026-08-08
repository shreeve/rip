// Deterministic browser bundle. The committed artifacts are byte-gated
// in CI, so the toolchain version is load-bearing: regeneration under
// a different Bun refuses instead of producing unexplained drift.
// Upgrading Bun is a deliberate change — regenerate, inspect the diff,
// and bump REQUIRED_BUN in the same commit.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { compile } from '../src/compile.js';

const REQUIRED_BUN = '1.3.14';
if (Bun.version !== REQUIRED_BUN) {
  console.error(
    `browser-bundle: Bun ${REQUIRED_BUN} required, found ${Bun.version}; ` +
    'the committed artifact is byte-gated against this exact toolchain',
  );
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist/browser');

// The emitter imports fs for inline runtime delivery, which the
// browser never uses (runtimes arrive by scope). The stub keeps the
// path honest: reaching it throws loudly instead of failing silently.
const nodeStubs = {
  name: 'rip-node-stubs',
  setup(build) {
    build.onResolve({ filter: /^(node:)?fs$/ }, () => ({ path: 'fs', namespace: 'rip-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'rip-stub' }, () => ({
      contents:
        "export const readFileSync = () => { throw new Error('rip: filesystem access is unavailable in the browser'); };\n",
      loader: 'js',
    }));
  },
};

// IDE / type-face modules: the browser ships Rip→JS only. JS-face helpers
// that emission needs at runtime live in schema.js / emitter.js;
// these stubs satisfy the emitter's static face:'ts' imports with loud
// throws if a TS-only path is ever reached in-page.
const unavailable = (surface) =>
  `() => { throw new Error('rip: ${surface} is unavailable in the browser'); }`;

const IDE_STUBS = new Map([
  ['dts.js', [
    `export const emitDeclarations = ${unavailable('declaration emission')};`,
  ].join('\n')],
  ['schemas.js', [
    `export class SchemaTypeError extends Error {`,
    `  constructor(message, start = null, node = null) {`,
    `    super(message);`,
    `    this.name = 'SchemaTypeError';`,
    `    this.start = start;`,
    `    this.node = node;`,
    `  }`,
    `}`,
    `export const buildSchemaTypeStory = ${unavailable('schema type story')};`,
    `export const isModuleShaped = () => false;`,
  ].join('\n')],
  ['typetext.js', [
    `export class TypeTextError extends Error {`,
    `  constructor(message) { super(message); this.name = 'TypeTextError'; }`,
    `}`,
    `export const normalizeTypeText = (raw) => String(raw ?? '').trim();`,
    `export const tidyType = (t) => String(t ?? '');`,
    `export const renderTypeDecl = ${unavailable('type-text rendering')};`,
    `export const renderParams = ${unavailable('type-text rendering')};`,
    `export const optionalReader = () => () => false;`,
    `export const jsArityOptional = () => new Set();`,
  ].join('\n')],
  ['components.js', [
    `export const componentTypeInfo = ${unavailable('component type story')};`,
    `export const memberDeclareSegments = ${unavailable('component type story')};`,
    `export const isDeclarableMember = () => false;`,
    `export const declaresContainer = () => false;`,
    `export const propsTypeSegments = ${unavailable('component type story')};`,
    `export const propsTypeText = ${unavailable('component type story')};`,
    `export const propsParamOptional = () => true;`,
    `export const instanceTypeLines = ${unavailable('component type story')};`,
    `export const containerType = ${unavailable('component type story')};`,
    `export const MINTED = '';`,
    `export const syntacticLiteralType = () => null;`,
    `export const selfArgsOf = () => '';`,
    `export const anyArgsOf = () => '';`,
    `export const readonlyCastType = ${unavailable('component type story')};`,
  ].join('\n')],
]);

const ideStubs = {
  name: 'rip-ide-stubs',
  setup(build) {
    // Stub only the types/ modules. Basenames alone are not enough —
    // `components.js` also names the reactive runtime module.
    build.onResolve({ filter: /(?:^|\/)(dts|schemas|typetext|components)\.js$/ }, (args) => {
      const file = args.path.split('/').pop();
      if (!IDE_STUBS.has(file)) return null;
      const inTypes = /(?:^|\/)types\//.test(args.path)
        || /(?:^|\/)types\//.test(args.importer || '');
      if (!inTypes) return null;
      return { path: file, namespace: 'rip-ide-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'rip-ide-stub' }, (args) => ({
      contents: IDE_STUBS.get(args.path) + '\n',
      loader: 'js',
    }));
  },
};

// @rip-lang/app is part of the stable browser distribution. Compile its Rip
// modules while building rip.js; authored App source still compiles in the
// browser, while the shared framework is transferred and evaluated once per
// runtime version instead of once per App publication.
const ripModules = {
  name: 'rip-browser-modules',
  setup(build) {
    build.onLoad({ filter: /\.rip$/ }, args => ({
      contents: compile(readFileSync(args.path, 'utf8'), {
        path: args.path,
        runtimeDelivery: 'import',
      }).code,
      loader: 'js',
    }));
  },
};

const buildOpts = {
  entrypoints: [resolve(root, 'src/browser.js')],
  root: resolve(root, 'src'),
  target: 'browser',
  format: 'esm',
  sourcemap: 'none',
  plugins: [ripModules, nodeStubs, ideStubs],
};

const result = await Bun.build({ ...buildOpts, minify: false });
if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}

const minResult = await Bun.build({ ...buildOpts, minify: true });
if (!minResult.success) {
  for (const log of minResult.logs) console.error(String(log));
  process.exit(1);
}

const code = await result.outputs[0].text();
const minCode = await minResult.outputs[0].text();
const minBytes = Buffer.from(minCode);
const brBytes = brotliCompressSync(minBytes, {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
  },
});

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'rip.js'), code);
writeFileSync(resolve(outDir, 'rip.min.js'), minBytes);
writeFileSync(resolve(outDir, 'rip.min.js.br'), brBytes);

const kb = n => (n / 1024).toFixed(1);
console.log(`browser-bundle: dist/browser/rip.js ${kb(Buffer.byteLength(code))} KB`);
console.log(`browser-bundle: dist/browser/rip.min.js ${kb(minBytes.length)} KB`);
console.log(`browser-bundle: dist/browser/rip.min.js.br ${kb(brBytes.length)} KB`);
