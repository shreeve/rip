import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as app from 'rip/app';

test('public entry exposes named substrate exports only', () => {
  expect(Object.keys(app).sort()).toEqual([
    'ariaCurrent',
    'browserAdapter',
    'buildRoutes',
    'check',
    'connectFeed',
    'createApply',
    'createComponents',
    'createMutation',
    'createRenderer',
    'createRouter',
    'createStash',
    'createWorkspace',
    'currentRouter',
    'currentStash',
    'debounce',
    'delay',
    'hold',
    'interceptClicks',
    'launch',
    'ownsAnchor',
    'parseQuery',
    'persistStash',
    'preloadLinks',
    'rash',
    'source',
    'throttle',
    'unwrapStash',
    'validatePrepared',
  ]);
  expect('default' in app).toBeFalse();
});

test('package has no dependency fields of any kind', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    expect(pkg[field]).toBeUndefined();
  }
});
