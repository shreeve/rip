// A stdlib package serves every `.rip` file under it by path, the same
// inventory the sites publication ships to the browser, so a subpath
// means one file on both sides. An exports key names its target and wins
// over the path; the trees the publication skips are not served.
import { test, expect } from 'bun:test';
import path from 'path';
import { bareSpecifierMap } from '../../src/resolver.js';

const packages = path.resolve(import.meta.dir, '..', '..', 'packages');

test('a file under a package resolves by its path, and an exports key still names its target', () => {
  const map = bareSpecifierMap();
  expect(map.get('rip/ui')).toBe(path.join(packages, 'ui', 'ui.rip'));
  expect(map.get('rip/ui/components/dialog.rip')).toBe(path.join(packages, 'ui', 'components', 'dialog.rip'));
  expect(map.get('rip/app/rash')).toBe(path.join(packages, 'app', 'rash.rip'));
  expect(map.get('rip/app/rash.rip')).toBe(path.join(packages, 'app', 'rash.rip'));
});

test('the test, bench, demo, and node_modules trees and the root verb files are not served by path', () => {
  const map = bareSpecifierMap();
  expect(map.has('rip/ui/test/browser/serve.rip')).toBe(false);
  expect(map.has('rip/validate/test.rip')).toBe(false);
  for (const name of map.keys()) {
    if (!name.startsWith('rip/')) continue;
    expect(name).not.toMatch(/^rip\/[^/]+\/(?:test|bench|demo|node_modules)\//);
    expect(name).not.toMatch(/^rip\/[^/]+\/(?:test|bench|demo)\.rip$/);
  }
});
