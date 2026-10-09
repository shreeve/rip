// Every package that claims browser safety earns it over its whole
// served inventory. A publication carries only the modules its imports
// reach, so this gate is where an unreached module's server-only import
// is caught: each served file is imported by path, the entry by its
// bare name, and the complete program must assemble and validate.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRipPublication } from '../../packages/sites/bundle.rip';
import { ripFilesUnder } from '../../src/resolver.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packagesDir = join(root, 'packages');

const manifestOf = name => {
  const path = join(packagesDir, name, 'package.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
};

// `rip/app` is embedded in the browser runtime, never assembled into a
// publication; its browser safety is the runtime build's.
const browserSafe = readdirSync(packagesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(name => name !== 'app' && manifestOf(name)?.rip?.browser === true)
  .sort();

describe('browser-safe packages', () => {
  expect(browserSafe.length).toBeGreaterThan(0);
  for (const name of browserSafe) {
    test(`rip/${name} serves only modules that travel to the browser`, () => {
      const packageRoot = join(packagesDir, name);
      const manifest = manifestOf(name);
      const entryTarget = manifest.exports?.['.'];
      const entry = (typeof entryTarget === 'string' ? entryTarget : entryTarget?.default ?? 'index.rip').replace(/^\.\//, '');
      const served = ripFilesUnder(packageRoot).map(file => relative(packageRoot, file).replaceAll('\\', '/'));
      // A package whose entry is not Rip source (a JavaScript grammar)
      // serves nothing the publication could carry.
      if (served.length === 0) return;
      const lines = served.map((file, index) => {
        const specifier = file === entry ? `rip/${name}` : `rip/${name}/${file}`;
        return `import * as m${index} from '${specifier}'`;
      });
      lines.push(`export gate = [${served.map((_, index) => `m${index}`).join(', ')}]`);
      const publication = assembleRipPublication({ modules: { 'gate.rip': lines.join('\n') }, packagesDir });
      const carried = publication.list.map(([path]) => path).filter(path => path.startsWith(`rip/${name}/`));
      expect(carried.length).toBe(served.length);
    });
  }
});
