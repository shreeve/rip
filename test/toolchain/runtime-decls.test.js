// Guard: the declaration beside each typed runtime (src/runtime/<key>.d.ts)
// is exactly what the runtime table produces. Fails when someone edits one
// by hand or forgets `bun run decls` after a table change — the
// regeneration rule, as for src/parser.js.
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { runtimeDeclarations } from '../../src/ts/runtime-decls.js';
import { _runtimeTable } from '../../src/emitter.js';

const runtimeDir = join(import.meta.dir, '../../src/runtime');
const generated = runtimeDeclarations();

describe('runtime declarations', () => {
  for (const { key, path, text } of generated) {
    test(`src/runtime/${key}.d.ts is current with the runtime table`, () => {
      expect(readFileSync(path, 'utf8')).toBe(text);
    });
  }

  // A declaration beside a runtime is either the table's or duckdb's
  // hand-written one; a new hand-written file is a decision, not a drift.
  test('the declarations beside the runtimes are the typed entries\' and duckdb\'s', () => {
    const typed = _runtimeTable().filter((rt) => rt.types).map((rt) => rt.key);
    expect(generated.map((g) => g.key)).toEqual(typed);
    expect(readdirSync(runtimeDir).filter((f) => f.endsWith('.d.ts')).sort())
      .toEqual([...typed, 'duckdb'].map((k) => `${k}.d.ts`).sort());
  });

  // The direct importers of the runtimes read the same types the injected
  // names carry: every name the schema, orm, reactive, and stdlib units
  // inject is typed (`__schema` as the open `unknown` return that only an
  // anonymous schema value meets), and so is the components unit's context
  // API; the names only emission spells, the runtime's internal helpers,
  // and the exports the table does not inject arrive `any`.
  test('every name the schema, orm, reactive, and stdlib units inject is declared typed, and the context API', () => {
    const typedNames = (key) => {
      const rt = _runtimeTable().find((r) => r.key === key);
      return key === 'components' ? ['setContext', 'getContext', 'hasContext'] : rt.names;
    };
    const declared = (key, name) => {
      const line = generated.find((g) => g.key === key).text.split('\n').find((l) => l.startsWith(`export declare const ${name}: `));
      expect(line, name).toBeDefined();
      return line;
    };
    for (const key of ['schema', 'orm', 'reactive', 'stdlib', 'components']) {
      for (const name of typedNames(key)) expect(declared(key, name), name).not.toMatch(/: any;$/);
    }
    // No `any` rides a typed signature either: an open parameter is `unknown`.
    for (const key of ['reactive', 'stdlib']) {
      for (const name of typedNames(key)) expect(declared(key, name), name).not.toMatch(/\bany\b/);
    }
    expect(declared('schema', '__schema')).toBe('export declare const __schema: (descriptor: unknown) => unknown;');
    expect(declared('schema', 'SchemaRegistry')).toBe('export declare const SchemaRegistry: any;');
    for (const name of ['__Component', '__reconcile', '__lis', '__ownerFrame']) expect(declared('components', name)).toBe(`export declare const ${name}: any;`);
  });

  // The alias text a signature names travels with it: the schema aliases
  // under schema.d.ts, orm's beside them in orm.d.ts, and the face's class
  // and style aliases in components.d.ts, which names lib.dom and says so.
  test('each declaration carries the aliases its signatures name and declares its lib dependency', () => {
    const text = Object.fromEntries(generated.map((g) => [g.key, g.text]));
    expect(text.schema).toMatch(/^type __RipSchemaIssue = /m);
    expect(text.schema).not.toContain('__RipAdapter');
    expect(text.orm).toMatch(/^type __RipAdapter = /m);
    expect(text.orm).toContain('export declare const schema: { transaction: {');
    expect(text.components).toMatch(/^type __RipClassValue = /m);
    expect(text.components).toMatch(/^type __RipCSSProperties = /m);
    expect(text.components.startsWith('/// <reference lib="dom" />\n')).toBe(true);
    expect(text.reactive).not.toContain('<reference');
    expect(text.stdlib).not.toContain('<reference');
  });
});
