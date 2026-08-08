// Vendor the Tailwind browser runtime into dist/@rip as the production
// IIFE plus a Brotli sidecar. Upstream @tailwindcss/browser already
// ships minified (same major/minor as packages/ui's tailwindcss), so
// there is no separate unminified twin — only tailwind.min.js and
// tailwind.min.js.br. Clients request /@rip/tailwind.min.js; Janus may
// serve the .br sidecar when Accept-Encoding includes br.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

const REQUIRED = '4.3.2';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist/@rip');
const require = createRequire(import.meta.url);

let pkgPath;
try {
  pkgPath = require.resolve('@tailwindcss/browser/package.json');
} catch {
  console.error(
    'tailwind: @tailwindcss/browser is not installed — run `bun install`',
  );
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version !== REQUIRED) {
  console.error(
    `tailwind: @tailwindcss/browser@${REQUIRED} required, found ${pkg.version}`,
  );
  process.exit(2);
}

const entry = pkg.exports?.['.']?.default
  ?? pkg.exports?.['.']?.browser
  ?? pkg.browser
  ?? pkg.main
  ?? './dist/index.global.js';
const sourcePath = resolve(dirname(pkgPath), entry);
const minBytes = readFileSync(sourcePath);
const brBytes = brotliCompressSync(minBytes, {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
  },
});

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'tailwind.min.js'), minBytes);
writeFileSync(resolve(outDir, 'tailwind.min.js.br'), brBytes);

const kb = n => (n / 1024).toFixed(1);
console.log(`tailwind: @tailwindcss/browser@${pkg.version} → dist/@rip`);
console.log(`tailwind: dist/@rip/tailwind.min.js ${kb(minBytes.length)} KB`);
console.log(`tailwind: dist/@rip/tailwind.min.js.br ${kb(brBytes.length)} KB`);
