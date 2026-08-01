import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as app from '@rip-lang/app';

test('public entry exposes named substrate exports only', () => {
  expect(Object.keys(app).sort()).toEqual([
    'ariaCurrent',
    'browserAdapter',
    'buildRoutes',
    'connectFeed',
    'createApply',
    'createComponents',
    'createMutation',
    'createRenderer',
    'createRouter',
    'createStash',
    'createWorkspace',
    'debounce',
    'delay',
    'hold',
    'interceptClicks',
    'launch',
    'ownsAnchor',
    'parseQuery',
    'persistStash',
    'preloadLinks',
    'source',
    'throttle',
    'unwrapStash',
  ]);
  expect('default' in app).toBeFalse();
});

test('package has no runtime dependency fields; testing is the only dev dep', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
  expect(pkg.devDependencies).toEqual({ '@rip-lang/testing': 'workspace:*' });
});
