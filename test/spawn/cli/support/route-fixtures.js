// Fixtures for the typed-routes cases (check-routes-1/-2.test.js): the
// stash, the link components, and the route tree — statics, a nested
// dynamic, an optional, a group, a catch-all, and layouts — the same
// shapes cart and medlabs use. Shared so the two files (split for
// `bun test --parallel`, which schedules whole files) build the same
// workspace.

export const STASH = [
  "import { source } from 'rip/app'",
  '',
  'export stash =',
  "  user: source fetch: -> Promise.resolve { name: 'Ada' }",
  '  order: source fetch: (id: string) -> Promise.resolve { id, total: 5 }',
  '  count: 0',
  '',
].join('\n');

export const LINKS = [
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
export const ROUTE_FILES = {
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
