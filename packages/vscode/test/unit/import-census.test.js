// The import census mirrors the lexer's type-only lookahead whole —
// `type` strips when `{`, `*`, or an identifier that is not `from`
// follows, and strips BEFORE the braced list comes off — so no spelling
// mints a binding that does not exist, and the default binding NAMED
// `type` keeps its reading.
import { describe, test, expect } from 'bun:test';
import { compile } from '../../../../src/compile.js';
import { importBindingsOf } from '../../src/scopes.js';

const bindingsOf = (source) => {
  const result = compile(source, { path: '/b.rip', runtimeDelivery: 'none', typeStores: true });
  return importBindingsOf(result.typeStores ?? result.stores, source);
};

describe('the census reads type-only import heads', () => {
  test('a type-only default binds its name, not `type`', () => {
    expect(bindingsOf("import type Foo from './m.rip'\n"))
      .toEqual([{ local: 'Foo', imported: 'default', module: './m.rip' }]);
  });

  test('a default binding named `type` keeps its reading', () => {
    expect(bindingsOf("import type from './m.rip'\n"))
      .toEqual([{ local: 'type', imported: 'default', module: './m.rip' }]);
  });

  test('a type-only clause mints no phantom default, brace-adjacent or spaced', () => {
    expect(bindingsOf("import type{ A } from './m.rip'\n"))
      .toEqual([{ local: 'A', imported: 'A', module: './m.rip' }]);
    expect(bindingsOf("import type { A } from './m.rip'\n"))
      .toEqual([{ local: 'A', imported: 'A', module: './m.rip' }]);
  });

  test('a type-only namespace head binds nothing here', () => {
    expect(bindingsOf("import type * as NS from './m.rip'\n")).toEqual([]);
  });
});
