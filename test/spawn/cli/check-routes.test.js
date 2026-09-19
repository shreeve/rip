// `rip check` — typed routes over the real server. The runner and
// workspace builders live in ./support/check-harness.js.

import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { describeExtended } from '../../support/extended.js';
import { workspace, check } from './support/check-harness.js';

// ── Typed routes ─────────────────────────────────────────────────────
//
// The route surfaces over the real server: the union discovered from
// `app/routes/**` checks `/`-leading LITERALS on three surfaces —
// intrinsic `<a href>`, a child component's `href:` prop, and
// `router.push`/`replace` — plus the ambient `RoutePath` and per-route
// `@params`. Everything dynamic or external passes BY CONSTRUCTION
// (never wrapped), the documented escape hatches hold, and checking
// stays unarmed without a route tree. The walker itself is pinned in
// packages/vscode/test/unit/routes-discovery.test.js and differentially
// against buildRoutes in packages/app/test/routes-discovery.test.js;
// these are the end-to-end diagnostics.
describeExtended('rip check: typed routes over the real server', () => {
  const STASH = [
    "import { source } from 'rip/app'",
    '',
    'export stash =',
    "  user: source fetch: -> Promise.resolve { name: 'Ada' }",
    '  order: source fetch: (id: string) -> Promise.resolve { id, total: 5 }',
    '  count: 0',
    '',
  ].join('\n');

  const LINKS = [
    'export ButtonLink = component extends a',
    '  render',
    '    a',
    '      slot',
    '',
    'export PlainLink = component',
    "  @href?: string := '/'",
    '  render',
    '    a href: @href',
    '      slot',
    '',
  ].join('\n');

  // The route tree: statics, a nested dynamic, an optional, a group, a
  // catch-all, and layouts — the same shapes cart and medlabs use.
  const ROUTE_FILES = {
    'index.rip': 'x = 1\n',
    'app/stash.rip': STASH,
    'app/components/link.rip': LINKS,
    'app/routes/_layout.rip': [
      'export Layout = component',
      '  ok: -> @params.anything',
      '  render',
      '    div',
      '      slot',
      '',
    ].join('\n'),
    'app/routes/docs/[[page]].rip': [
      'export Docs = component',
      "  ok: -> @params.page ?? 'default'",
      '  render',
      "    div 'docs'",
      '',
    ].join('\n'),
    'app/routes/files/[...rest].rip': [
      'export Files = component',
      '  ok: -> @params.rest',
      '  render',
      "    div 'files'",
      '',
    ].join('\n'),
    'app/routes/(admin)/settings.rip': [
      'export Settings = component',
      '  render',
      "    div 'settings'",
      '',
    ].join('\n'),
    'app/routes/orders/index.rip': [
      'export Orders = component',
      '  ok: -> @params.anything',
      '  render',
      "    div 'orders'",
      '',
    ].join('\n'),
    'app/routes/orders/[id].rip': [
      'export Order = component',
      '  ok: -> @params.id',
      '  render',
      '    div @params.id',
      '',
    ].join('\n'),
    'app/routes/cart.rip': [
      'export Cart = component',
      '  render',
      "    div 'cart'",
      '',
    ].join('\n'),
  };

  test('every legitimate spelling passes: literals, dynamics, externals, escape hatches, params, typed handles', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/index.rip': [
        "import { ButtonLink, PlainLink } from '../components/link.rip'",
        '',
        'export Home = component',
        "  nav: RoutePath = '/orders'",
        "  data: { href: string } = { href: '/docs/api.html' }",
        "  id := '7'",
        '  go: ->',
        "    @router.push '/cart'",
        "    @router.replace '/'",
        "    @router.push (@router.path ?? '/') + '?page=2'",
        '    @router.push @data.href',
        '    @router.back()',
        "    @stash.source('user').reset()",
        "    @stash.source('user.name').reset()",
        "    @stash.source('order', 'o1').value?.total",
        '  render',
        "    a href: '/cart', 'literal'",
        "    a href: '/settings', 'grouped'",
        "    a href: '/docs', 'optional-absent'",
        '    a href: "/orders/#{@id}", \'interpolated\'',
        "    a href: 'https://example.com', 'external'",
        "    a href: 'mailto:x@y.z', 'mail'",
        "    a href: '#frag', 'fragment'",
        "    a href: '/cart?page=2', 'queried'",
        '    a href: "/orders/#{@id}#items", \'interpolated-queried\'',
        "    a href: '/settings?tab=a#b', 'queried-and-fragment'",
        '    a href: @nav, \'dynamic\'',
        '    a href: @data.href, \'string-typed-data\'',
        "    a href: ('/nowhere' as string), 'cast-hatch'",
        "    area href: '/not-a-route'",   // href on a non-anchor tag is never route-wrapped
        "    ButtonLink href: '/cart', 'component'",
        "    ButtonLink href: '/cart?page=2', 'component-queried'",
        '    ButtonLink href: @nav, \'component-dynamic\'',
        "    PlainLink href: '/orders', 'own-prop'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const r = check(dir);
      expect(r.stdout).toContain('No type errors');
      expect(r.status).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('every checked surface rejects a typo, anchored by its shape, naming the union', () => {
    const BAD = [
      "import { ButtonLink, PlainLink } from '../components/link.rip'",
      '',
      'export Home = component',
      "  bogus: RoutePath = '/orderz'",
      '  bad: ->',
      "    @router.push '/cartz'",
      "    @router.replace '/ordersz'",
      // A typo'd source key errors AT THE KEY — the `__ripSourceKey`
      // wrap checks syntactic literals against the stash's key union
      // (dotted paths under a real key stay legal on the template arm).
      "    @stash.source('userz').reset()",
      '  render',
      "    a href: '/carts', 'typo'",
      '    a href: "/orderz/#{1}", \'template-typo\'',
      "    ButtonLink href: '/cartz', 'component-typo'",
      "    PlainLink href: '/ordersz', 'own-prop-typo'",
      // A query or fragment never rescues a route the union lacks: the
      // check judges the path part, and the suggestion keeps the tail.
      "    a href: '/cartz?page=2', 'queried-typo'",
      "    ButtonLink href: '/ordersz#top', 'component-queried-typo'",
      '',
    ].join('\n');
    const dir = workspace({ ...ROUTE_FILES, 'app/routes/index.rip': BAD }, { strict: true });
    try {
      const r = check(dir);
      expect(r.status).toBe(1);
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('app/routes/index.rip'));
      // One diagnostic per surface, none elsewhere: the RoutePath
      // annotation (2820 — assignability with a did-you-mean, this
      // union has a near miss to suggest) and the nine wrapped/checked
      // positions (2345 — the six route surfaces, the source key, and
      // the two queried typos).
      expect(diags.length).toBe(10);
      expect(new Set(diags.map((d) => d.code))).toEqual(new Set([2820, 2345]));
      // Every mismatch anchors where tsgo anchors the construct the
      // lowering mimics: the four attribute typos on the pair's KEY (a
      // JSX attribute's anchor — the one every other mistyped attribute
      // in the DSL reports on), a call argument on the literal, and a
      // member declaration's own mismatch on the NAME — not the whole
      // declaration the lowered `this.bogus = …` write would cover.
      const lines = BAD.split('\n');
      const spanText = (d) => lines[d.line - 1].slice(d.column - 1, d.endColumn - 1);
      expect(diags.filter((d) => spanText(d) === 'href').map((d) => d.line)).toEqual([10, 11, 12, 13, 14, 15]);
      expect(diags.filter((d) => d.line === 4).map(spanText)).toEqual(['bogus']);
      expect(diags.filter((d) => d.line === 6).map(spanText)).toEqual(["'/cartz'"]);
      expect(diags.filter((d) => d.line === 7).map(spanText)).toEqual(["'/ordersz'"]);
      // The source-key typo anchors at the literal (not a route
      // surface; v3 parity — v3 never snapped source()).
      expect(diags.filter((d) => d.line === 8).map(spanText)).toEqual(["'userz'"]);
      // The message carries the actual literal and the actual routes —
      // prettified (dynamic members as their parameterized display) and
      // in WALKER order (`/docs/:page` beside `/docs`), not tsgo's
      // statics-first normalization.
      const text = check(dir).stdout;
      expect(text).toContain('"/carts"');
      expect(text).toContain('"/" | "/cart" | "/docs" | `/docs/:page` | "/files" | `/files/*rest` | "/orders" | `/orders/:id` | "/settings"');
      // No ROUTE member ever reads as its checked form.
      expect(text).not.toContain('/docs/${string}');
      expect(text).not.toContain('/orders/${string}');
      // A static route one slip away is named, in tsgo's own annotation
      // words (the RoutePath line's TS2820 reads the same way).
      expect(text).toContain(`'"/cartz"' is not assignable to parameter of type '"/" | "/cart" | "/docs" | \`/docs/:page\` | "/files" | \`/files/*rest\` | "/orders" | \`/orders/:id\` | "/settings"'. Did you mean '"/cart"'?`);
      expect(text).toContain(`'"/ordersz"' is not assignable to parameter of type '"/" | "/cart" | "/docs" | \`/docs/:page\` | "/files" | \`/files/*rest\` | "/orders" | \`/orders/:id\` | "/settings"'. Did you mean '"/orders"'?`);
      expect(text).toContain(`'"/cartz?page=2"' is not assignable to parameter of type '"/" | "/cart" | "/docs" | \`/docs/:page\` | "/files" | \`/files/*rest\` | "/orders" | \`/orders/:id\` | "/settings"'. Did you mean '"/cart?page=2"'?`);
      expect(text).toContain(`'"/ordersz#top"' is not assignable to parameter of type '"/" | "/cart" | "/docs" | \`/docs/:page\` | "/files" | \`/files/*rest\` | "/orders" | \`/orders/:id\` | "/settings"'. Did you mean '"/orders#top"'?`);
      // The source-key miss reads as one — the checker's union of keys
      // and dotted arms never prints — with the nearest key named.
      expect(text).toContain("'userz' is not a stash key — did you mean 'user'?");
      expect(text).not.toContain('user.${string}');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('the app accessors check outside any component: currentStash()/currentRouter(), optional-chained or not', () => {
    const NAV = [
      "import { currentRouter as cr, currentStash } from 'rip/app'",
      '',
      'export leave = ->',
      "  currentStash()?.source('user').reset()",
      "  currentStash()?.source('user.name').reset()",
      "  cr()?.push('/cart')",
      "  cr()?.replace('/orders')",
      "  key = 'user'",
      '  currentStash()?.source(key).reset()',
      '  r = cr()',
      "  r?.push('/not-a-route')",
      '',
      'export leaveBadly = ->',
      "  currentStash()?.source('userz').reset()",
      "  cr()?.push('/cartz')",
      "  cr()?.replace('/ordersz')",
      "  currentStash().source('userz').reset()",
      "  cr().push('/cartz')",
      '',
    ].join('\n');
    const dir = workspace({ ...ROUTE_FILES, 'app/nav.rip': NAV }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('app/nav.rip'));
      const lines = NAV.split('\n');
      const spanText = (d) => lines[d.line - 1].slice(d.column - 1, d.endColumn - 1);
      // The two gates report exactly as they do on `@stash` / `@router`:
      // the key typo at the literal, the route typos on the method
      // name. The non-optional spellings add strict's own TS2532 on
      // the possibly-undefined receiver and nothing else.
      expect(diags.filter((d) => d.code === 2345).map((d) => [d.line, spanText(d)])).toEqual([
        [14, "'userz'"], [15, "'/cartz'"], [16, "'/ordersz'"], [17, "'userz'"], [18, "'/cartz'"],
      ]);
      expect(diags.filter((d) => d.code !== 2345).map((d) => [d.code, d.line])).toEqual([[2532, 17], [2532, 18]]);
      // The accessor's misses read in the same words as the ambient forms'.
      expect(diags.filter((d) => d.code === 2345 && (d.line === 14 || d.line === 17)).map((d) => d.message)).toEqual([
        "'userz' is not a stash key — did you mean 'user'?",
        "'userz' is not a stash key — did you mean 'user'?",
      ]);
      expect(diags.find((d) => d.line === 15).message).toEndWith(`Did you mean '"/cart"'?`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('the stash reads as the stash: a member miss names it, a handle prints one arm', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/index.rip': [
        'export Home = component',
        '  bad: ->',
        '    @stash.userz = 1',
        "    s: string = @stash.source('user')",
        "    @stash.source('user').valu",
        '  render null',
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout)
        .filter((d) => d.file.endsWith('app/routes/index.rip'));
      expect(diags.map((d) => [d.line, d.code, d.message])).toEqual([
        // The ambience's expansion (every entry's declaration shape and
        // the method surface) never prints; the miss is worded from the
        // stash module's own keys.
        [3, 2551, "'userz' is not on the stash — did you mean 'user'?"],
        // A singleton entry's handle is ONE handle: its `T | null` value
        // does not distribute into a `SourceHandle<never>` arm.
        [4, 2322, "Type 'SourceHandle<{ name: string; }>' is not assignable to type 'string'."],
        [5, 2551, "Property 'valu' does not exist on type 'SourceHandle<{ name: string; }>'. Did you mean 'value'?"],
      ]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  test('per-route params: dynamic, catch-all, and optional shapes; statics and layouts keep the baseline', () => {
    const dir = workspace({
      ...ROUTE_FILES,
      'app/routes/orders/[id].rip': [
        'export Order = component',
        '  ok: -> @params.id',
        '  bad: -> @params.bogus',
        '  render',
        '    div @params.id',
        '',
      ].join('\n'),
      'app/routes/files/[...rest].rip': [
        'export Files = component',
        '  ok: -> @params.rest',
        '  bad: -> @params.id',
        '  render',
        "    div 'files'",
        '',
      ].join('\n'),
    }, { strict: true });
    try {
      const diags = JSON.parse(check(dir, ['--json']).stdout);
      const at = (suffix) => diags.filter((d) => d.file.endsWith(suffix)).map((d) => d.code);
      expect(at('orders/[id].rip')).toEqual([2339]);
      expect(at('files/[...rest].rip')).toEqual([2339]);
      // Statics, layouts, and the optional route carry no params noise.
      expect(at('orders/index.rip')).toEqual([]);
      expect(at('_layout.rip')).toEqual([]);
      expect(at('docs/[[page]].rip')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

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
