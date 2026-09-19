// `rip check` — typed routes over the real server, part 2 of 2 (cases
// 6–11; see check-routes-1.test.js for the surfaces under test and why
// the describe is split). The runner and workspace builders live in
// ./support/check-harness.js, the route tree in ./support/route-fixtures.js.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { describeExtended } from '../../support/extended.js';
import { workspace, check } from './support/check-harness.js';
import { STASH, ROUTE_FILES } from './support/route-fixtures.js';

describeExtended('rip check: typed routes over the real server', () => {
  test('a defaulted-D stash handle answers unknown — a consumer narrows, never receives any', () => {
    // Bare `createStash()` types its handles off StashMethods' DEFAULT
    // `D`; the untyped arm of SourceHandleFor must answer the bare
    // handle (`value: unknown`) so an unnarrowed use is an error — the
    // defaulted surface must never silently widen to `any`.
    const dir = workspace({
      'stash-consumer.rip': [
        "import { createStash } from 'rip/app'",
        'stash = createStash()',
        "n: number = stash.source('x').value",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('stash-consumer.rip'));
      expect(diags.map((d) => d.code)).toEqual([2322]);
      expect(diags[0].message).toContain("'unknown'");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('a user-declared RoutePath wins over the ambient alias', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/index.rip': [
        'type RoutePath = string',
        '',
        'export Home = component',
        "  loose: RoutePath = '/definitely-not-a-route'",
        '  render',
        '    div',
        '      = @loose',
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      expect(check(dir).status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('arming: no route tree, or a catch-all-only tree, leaves every literal unchecked', () => {
    const bare = workspace({
      'index.rip': 'x = 1\n',
      'app/stash.rip': STASH,
      'page.rip': [
        'export Page = component',
        '  render',
        "    a href: '/no-routes-here', 'fine'",
        '',
      ].join('\n'),
    }, { strict: true });
    const fallbackOnly = workspace({
      'index.rip': 'x = 1\n',
      'app/stash.rip': STASH,
      'app/routes/[...rest].rip': [
        'export Fallback = component',
        '  ok: -> @params.rest',
        '  render',
        "    a href: '/anything-goes', 'fine'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      expect(check(bare).status).toBe(0);
      expect(check(fallbackOnly).status).toBe(0);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
      fs.rmSync(fallbackOnly, { recursive: true, force: true });
    }
  }, 120_000);

  test('routes without a stash: hrefs check, the router stays untyped (v3 parity gate)', () => {
    const dir = workspace({
      'index.rip': 'x = 1\n',
      'app/routes/cart.rip': ROUTE_FILES['app/routes/cart.rip'],
      'app/routes/index.rip': [
        'export Home = component',
        '  bad: ->',
        "    @router.push '/cartz'",
        '  render',
        "    a href: '/carts', 'typo'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      // Exactly the href typo: push rides the untyped router ambience.
      expect(diags.map((d) => [path.basename(d.file), d.code])).toEqual([['index.rip', 2345]]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('gradual mode still surfaces route typos — real errors with cheap escapes', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/index.rip': [
        'export Home = component',
        '  render',
        "    a href: '/carts', 'typo'",
        '',
      ].join('\n'),
    });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('app/routes/index.rip'));
      expect(diags.map((d) => d.code)).toEqual([2345]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('the pin pass carries the route options: a pinned file keeps its route diagnostic exact', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/index.rip': [
        // A hoisted binding read inside a nested function is the Tier-3
        // pinnable shape; the recompile it triggers must reproduce the
        // SAME face, route wraps included, or this diagnostic drifts.
        'config = { limit: 5 }',
        'readLimit = -> config.limit',
        '',
        'export Home = component',
        '  render',
        "    a href: '/carts', 'typo'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('app/routes/index.rip'));
      expect(diags.length).toBe(1);
      expect(diags[0].code).toBe(2345);
      expect(diags[0].line).toBe(6);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
