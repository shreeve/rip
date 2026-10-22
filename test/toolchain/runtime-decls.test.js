// Guard: the declaration beside each typed runtime (src/runtime/<key>.d.ts)
// is exactly what the runtime table and src/ts/runtime-exports.js produce.
// Fails when someone edits one by hand or forgets `bun run decls` after a
// change to either source — the regeneration rule, as for src/parser.js.
import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { runtimeDeclarations, layout } from '../../src/ts/runtime-decls.js';
import { RUNTIME_EXPORT_TYPES } from '../../src/ts/runtime-exports.js';
import { _runtimeTable, _runtimeExports } from '../../src/emitter.js';

const runtimeDir = join(import.meta.dir, '../../src/runtime');
const generated = runtimeDeclarations();
const text = Object.fromEntries(generated.map((g) => [g.key, g.text]));

// A companion with one runtime's entry replaced.
const companionWith = (key, entry) => ({ ...RUNTIME_EXPORT_TYPES, [key]: { ...RUNTIME_EXPORT_TYPES[key], ...entry } });
const typesWith = (key, types) => companionWith(key, { types: { ...RUNTIME_EXPORT_TYPES[key].types, ...types } });
const typesWithout = (key, name) => {
  const { [name]: _, ...rest } = RUNTIME_EXPORT_TYPES[key].types;
  return companionWith(key, { types: rest });
};

describe('runtime declarations', () => {
  for (const { key, path, text: expected } of generated) {
    test(`src/runtime/${key}.d.ts is current with the runtime table and src/ts/runtime-exports.js`, () => {
      expect(readFileSync(path, 'utf8')).toBe(expected);
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

  // Every export of every typed runtime is declared, and no declaration
  // spells `any`: an injected name carries the table's signature, every
  // other export the companion's, and an open value is `unknown`.
  test('every export is declared and no declaration spells any', () => {
    for (const rt of _runtimeTable()) {
      if (!rt.types) continue;
      for (const name of _runtimeExports(rt)) {
        expect(text[rt.key], `${rt.key}.${name}`).toMatch(new RegExp(`^export declare (?:const|class) ${name}\\b`, 'm'));
      }
      for (const line of text[rt.key].split('\n')) {
        if (!line.startsWith('/')) expect(line, rt.key).not.toMatch(/\bany\b/);
      }
    }
    expect(text.schema).toContain('export declare const __schema: (descriptor: unknown) => unknown;\n');
    expect(text.schema).toContain('export declare class SchemaDef {\n  constructor(descriptor: unknown);\n');
    expect(text.components).toContain('export declare class __Component {\n  constructor(props?: Record<string, unknown>);\n  mount(target?: Node | string): this;\n');
    expect(text.components).toContain('export declare const __hmrEvents: () => __RipHmrEvent[];\n');
  });

  // A module export the `schema` namespace also carries spells the
  // namespace member's signature, read off the table rather than twice.
  test('the orm exports the schema namespace carries share its signatures', () => {
    const namespace = text.orm.slice(text.orm.indexOf('export declare const schema: {\n'), text.orm.indexOf('\nexport declare const __schemaSetAdapter'));
    const member = (name) => namespace.match(new RegExp(`^  ${name}: ([\\s\\S]*?);\\n  [a-z]`, 'm'))[1];
    const declared = (name) => text.orm.split('\nexport declare const ').find((block) => block.startsWith(`${name}: `)).slice(name.length + 2).replace(/;\n?$/, '');
    for (const [exported, inNamespace] of [['transaction', 'transaction'], ['connect', 'connect'], ['sequenceSetting', 'sequence']]) {
      expect(declared(exported).replace(/\n/g, '\n  ')).toBe(member(inNamespace));
    }
  });

  // The generator refuses an export it has no signature for, a companion
  // entry the module does not export or the table already types, a
  // signature spelling `any`, and a namespace reference to nothing.
  test('an untyped export, a misplaced entry, or an any refuses rather than lands', () => {
    expect(() => runtimeDeclarations({ exports: typesWithout('orm', 'txHandle') }))
      .toThrow("runtime 'orm' exports 'txHandle' with no signature");
    expect(() => runtimeDeclarations({ exports: typesWith('orm', { txHandlez: '() => void' }) }))
      .toThrow("types 'txHandlez' for runtime 'orm', but its module does not export it");
    expect(() => runtimeDeclarations({ exports: typesWith('orm', { __schemaSetAdapter: '() => void' }) }))
      .toThrow("'__schemaSetAdapter' of runtime 'orm' is typed by the table and by src/ts/runtime-exports.js");
    expect(() => runtimeDeclarations({ exports: typesWith('orm', { txHandle: '(adapter: any) => unknown' }) }))
      .toThrow("runtime 'orm': a declaration spells `any`");
    expect(() => runtimeDeclarations({ exports: typesWith('orm', { txHandle: { namespace: 'schema', member: 'handle' } }) }))
      .toThrow("refers to 'schema.handle', which that namespace type has no member for");
    expect(() => runtimeDeclarations({ exports: typesWith('orm', { txHandle: { namespace: 'schemaz', member: 'handle' } }) }))
      .toThrow("refers to table namespace 'schemaz', which the table does not type");
  });

  // The alias text a signature names travels with it: the schema aliases
  // under schema.d.ts, orm's beside them in orm.d.ts with the SchemaDef
  // import its signatures take, and the face's class and style aliases in
  // components.d.ts, which names lib.dom and says so.
  test('each declaration carries the aliases its signatures name and declares its lib dependency', () => {
    expect(text.schema).toMatch(/^type __RipSchemaIssue = \{$/m);
    expect(text.schema).not.toContain('__RipAdapter');
    expect(text.orm).toMatch(/^type __RipAdapter = \{$/m);
    expect(text.orm).toContain("\nimport type { SchemaDef } from './schema.js';\n");
    expect(text.components).toMatch(/^type __RipClassValue = /m);
    expect(text.components).toMatch(/^type __RipCSSProperties = \{$/m);
    expect(text.components.startsWith('/// <reference lib="dom" />\n')).toBe(true);
    expect(text.reactive).not.toContain('<reference');
    expect(text.stdlib).not.toContain('<reference');
  });

  // One member per line: a brace body opens on its line, each member
  // lands two spaces deeper with a closing `;`, and the body closes on the
  // enclosing indent, at every depth; a parameter list, a literal, and an
  // empty body stay whole.
  test('a declaration lays out one member per line', () => {
    expect(text.orm).toContain('\n\nexport declare const schema: {\n  transaction: {\n    <T>(fn: () => T): Promise<Awaited<T>>;\n');
    expect(text.orm).toContain('\n  plan: () => never;\n  status: () => never;\n');
    expect(layout('type T = { a: X; b: { c: Y; d: Z } };')).toBe('type T = {\n  a: X;\n  b: {\n    c: Y;\n    d: Z;\n  };\n};');
    expect(layout('declare const f: (o: { a: X; b: Y }, n: number) => { r: Z };'))
      .toBe('declare const f: (o: {\n  a: X;\n  b: Y;\n}, n: number) => {\n  r: Z;\n};');
    expect(layout('type T = {\n    a: X;\n    b: Y;\n  };')).toBe('type T = {\n  a: X;\n  b: Y;\n};');
    expect(layout("type T = { [k: `--${string}`]: '{;}' | string }")).toBe("type T = {\n  [k: `--${string}`]: '{;}' | string;\n}");
    expect(layout('type T = {};')).toBe('type T = {};');
    expect(layout('/** a { doc; } */')).toBe('/** a { doc; } */');
    expect(layout("import type { A, B } from './a.js';")).toBe("import type { A, B } from './a.js';");
  });

  // A multi-line declaration stands as a paragraph; one-liners stay packed,
  // and the header, an import, and a doc comment attach to what follows.
  test('multi-line declarations are paragraphs and one-liners stay packed', () => {
    expect(text.orm).toContain('};\n\ntype __RipAdapterQuery = (');
    expect(text.orm).toContain('};\n\nexport declare const adoptTransaction: <T>(adapter: __RipAdapter, handle: __RipTxHandle, fn: (settle: (outcome: \'afterCommit\' | \'afterRollback\') => Promise<void>) => T) => Promise<Awaited<T>>;\nexport declare const txHandle: (adapter: __RipAdapter) => __RipTxHandle | null;\n\nexport declare const connect: (');
    expect(text.orm).toContain('export declare const adapterConfigured: () => boolean;\nexport declare const quoteIdent: (');
    expect(text.orm).toMatch(/^\/\/ Generated[^\n]*\nimport type \{ SchemaDef \} from '\.\/schema\.js';\ntype __RipAdapterResult = \{\n/);
    expect(text.components).toContain('\n\n/** An inline style');
    expect(text.components).toMatch(/\*\/\ntype __RipCSSProperties = \{\n/);
    expect(text.stdlib).toContain('export declare const pr: <T>(v: T) => T;\n\nexport declare const raise: {\n');
    expect(text.stdlib).toContain('export declare const abort: (msg?: string) => never;\nexport declare const assert: ');
    for (const key of Object.keys(text)) expect(text[key], key).not.toContain('\n\n\n');
  });
});
