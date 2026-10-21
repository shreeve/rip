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

  // The direct importers of schema.js and orm.js read the same types the
  // injected names carry — every one typed, `__schema` as the open
  // `unknown` return that only an anonymous schema value meets — and the
  // exports the table does not inject arrive `any`.
  test('every name the schema and orm units inject is declared typed', () => {
    for (const key of ['schema', 'orm']) {
      const rt = _runtimeTable().find((r) => r.key === key);
      const lines = generated.find((g) => g.key === key).text.split('\n');
      for (const name of rt.names) {
        const line = lines.find((l) => l.startsWith(`export declare const ${name}: `));
        expect(line, name).toBeDefined();
        expect(line, name).not.toMatch(/: any;$/);
      }
    }
    expect(generated.find((g) => g.key === 'schema').text).toContain('export declare const __schema: (descriptor: unknown) => unknown;');
    expect(generated.find((g) => g.key === 'schema').text).toContain('export declare const SchemaRegistry: any;');
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
