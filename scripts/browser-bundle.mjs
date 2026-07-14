// Deterministic browser bundle. The committed artifact is byte-gated
// in CI, so the toolchain version is load-bearing: regeneration under
// a different Bun refuses instead of producing unexplained drift.
// Upgrading Bun is a deliberate change — regenerate, inspect the diff,
// and bump REQUIRED_BUN in the same commit.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_BUN = '1.3.14';
if (Bun.version !== REQUIRED_BUN) {
  console.error(
    `browser-bundle: Bun ${REQUIRED_BUN} required, found ${Bun.version}; ` +
    'the committed artifact is byte-gated against this exact toolchain',
  );
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const result = await Bun.build({
  entrypoints: [resolve(root, 'src/browser.js')],
  root: resolve(root, 'src'),
  target: 'browser',
  format: 'esm',
  minify: false,
  sourcemap: 'none',
  plugins: [nodeStubs],
});

if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}

const code = await result.outputs[0].text();
mkdirSync(resolve(root, 'dist/browser'), { recursive: true });
writeFileSync(resolve(root, 'dist/browser/rip.js'), code);
console.log(`browser-bundle: dist/browser/rip.js ${(code.length / 1024).toFixed(1)} KB`);
