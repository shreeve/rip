// Deterministic browser bundle. The committed artifacts are byte-gated
// in CI, so the toolchain version is load-bearing: regeneration under
// a different Bun refuses instead of producing unexplained drift.
// Upgrading Bun is a deliberate change — regenerate, inspect the diff,
// and bump `.bun-version` in the same commit.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { compile } from '../src/compiler.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist/@rip');

// `.bun-version` is the repo's only Bun pin: the CI setup-bun steps read
// the same file through `bun-version-file`, and test/toolchain/bun-pin.test.js
// holds them to it. Bun itself never reads it, so a mismatched runtime is
// caught here rather than refused at startup.
const REQUIRED_BUN = readFileSync(resolve(root, '.bun-version'), 'utf8').trim();
if (Bun.version !== REQUIRED_BUN) {
  console.error(
    `browser: Bun ${REQUIRED_BUN} required, found ${Bun.version}; ` +
    'the committed artifact is byte-gated against this exact toolchain',
  );
  process.exit(2);
}

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

// The browser ships Rip→JS only. src/emit/face.js is the whole TS face
// (TsEmitter and everything it imports from src/ts/): its stub's
// TsEmitter rejects construction, so emit() with face 'ts' fails loudly
// before any analysis, and none of the face's code reaches the bundle.
// The src/ts/ stubs cover what the JS face still imports from there:
// declaration emission (compiler.js's lazy `declarations` getter) and
// the annotation-text normalizer.
const unavailable = (surface) =>
  `() => { throw new Error('rip: ${surface} is unavailable in the browser'); }`;

const SRC_DIR = resolve(root, 'src');

const STUBS = new Map([
  ['emit/face.js', [
    `const faceUnavailable = ${unavailable('the TS face')};`,
    `export class TsEmitter { constructor() { faceUnavailable(); } }`,
    `export const stripFace = faceUnavailable;`,
  ].join('\n')],
  ['ts/dts.js', [
    `export const emitDeclarations = ${unavailable('declaration emission')};`,
  ].join('\n')],
  ['ts/types.js', [
    `export const normalizeTypeText = (raw) => String(raw ?? '').trim();`,
  ].join('\n')],
]);

const ideStubs = {
  name: 'rip-ide-stubs',
  setup(build) {
    // The decision is made on the RESOLVED location, never on the
    // basename and never on the importer: every basename here is also a
    // module somewhere else (src/schema.js, src/runtime/components.js),
    // and testing the importer would stub a real compiler module that a
    // stubbed directory happens to import.
    build.onResolve({ filter: /(?:^|\/)(face|dts|types)\.js$/ }, (args) => {
      const target = args.path.startsWith('.')
        ? resolve(dirname(args.importer || ''), args.path)
        : args.path;
      const key = relative(SRC_DIR, target);
      if (!STUBS.has(key)) return null;
      return { path: key, namespace: 'rip-ide-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'rip-ide-stub' }, (args) => ({
      contents: STUBS.get(args.path) + '\n',
      loader: 'js',
    }));
  },
};

// rip/app is part of the stable browser distribution. Compile its Rip
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

const build = async (opts) => {
  const out = await Bun.build({ ...buildOpts, ...opts });
  if (!out.success) {
    for (const log of out.logs) console.error(String(log));
    process.exit(1);
  }
  return out.outputs[0].text();
};

// The compiler build id keys the page's compiled-module cache
// (src/browser.js): a digest of the unstamped bundle, so any change to
// what the bundle carries is a new build, and regenerating an unchanged
// tree reproduces the same id.
const unstamped = await build({ minify: false, define: { RIP_COMPILER_BUILD: '"unstamped"' } });
const buildId = new Bun.CryptoHasher('sha256').update(unstamped).digest('hex').slice(0, 16);
const define = { RIP_COMPILER_BUILD: JSON.stringify(buildId) };

const code = await build({ minify: false, define });
const minCode = await build({ minify: true, define });
for (const [name, text] of [['rip.js', code], ['rip.min.js', minCode]]) {
  if (!text.includes(`"${buildId}"`) || text.includes('RIP_COMPILER_BUILD')) {
    console.error(`browser: ${name} does not carry compiler build ${buildId}`);
    process.exit(1);
  }
}
const minBytes = Buffer.from(minCode);
const brBytes = brotliCompressSync(minBytes, {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
  },
});

// Watch ships twice from one source: bundled into the runtime
// above (armed by a `watch` script attribute) and copied verbatim as the
// standalone /@rip/watch.js include. No compile step — the source is
// plain browser JS with no imports, valid as a classic script.
const watchBytes = readFileSync(resolve(root, 'src/watch.js'));

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'rip.js'), code);
writeFileSync(resolve(outDir, 'rip.min.js'), minBytes);
writeFileSync(resolve(outDir, 'rip.min.js.br'), brBytes);
writeFileSync(resolve(outDir, 'watch.js'), watchBytes);

const kb = n => (n / 1024).toFixed(1);
console.log(`browser: dist/@rip/rip.js ${kb(Buffer.byteLength(code))} KB`);
console.log(`browser: dist/@rip/rip.min.js ${kb(minBytes.length)} KB`);
console.log(`browser: dist/@rip/rip.min.js.br ${kb(brBytes.length)} KB`);
console.log(`browser: dist/@rip/watch.js ${kb(watchBytes.length)} KB`);
