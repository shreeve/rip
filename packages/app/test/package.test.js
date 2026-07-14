import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as app from '@rip-lang/app';

test('public entry exposes named substrate exports only', () => {
  expect(Object.keys(app).sort()).toEqual([
    'browserAdapter',
    'buildRoutes',
    'createComponents',
    'createMutation',
    'createRenderer',
    'createRouter',
    'createStash',
    'debounce',
    'delay',
    'hold',
    'launch',
    'parseQuery',
    'persistStash',
    'source',
    'throttle',
    'unwrapStash',
  ]);
  expect('default' in app).toBeFalse();
});

test('package has no dependency fields', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    expect(pkg[field]).toBeUndefined();
  }
});
