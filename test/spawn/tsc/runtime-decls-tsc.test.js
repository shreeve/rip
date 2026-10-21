// The runtime declarations ↔ implementations gate: each `.d.ts` beside a
// runtime module (the table's generated ones and duckdb's hand-written
// one) is checked by the pinned tsc against that module's JavaScript, so
// a signature the implementation does not satisfy fails here rather than
// shipping into every face and every direct importer.
//
// Two assertions per module, each a typed assignment in a probe file:
//
//   satisfied — the implementation's module type is assignable to the
//     declaration's: every declared name exists, every declared member of
//     an exported object exists, a declared parameter type is accepted,
//     and a declared return is what the function returns (`__readonly`
//     declared to return its argument fails: the runtime returns a cell).
//   declared — every export the module makes, and every member of an
//     exported object the declaration types as an object, has a
//     declaration (`Undeclared` lists the paths that do not).
//
// The JavaScript is read with allowJs and no checkJs: its inferred shapes
// are what the gate compares against, its own bodies are not under test.
// Inference has a standing limit the gate inherits — it cannot see a
// literal narrower than its base type (a class property assigned
// `'SchemaError'` is `string`; an object literal's `tx: true` is
// `boolean`), so a declaration claims no such literal — and a parameter
// whose default is `null` is `null` unless a JSDoc says otherwise, which
// duckdb.js's wire functions carry. strictNullChecks stays ON: the declarations are
// consumed strict, and a gate that compared loose would pass what the
// faces refuse.
//
// Rides the EXTENDED tier: it spawns the pinned tsc (resolveTsc).
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from '../../support/spawn.js';
import { describeExtended, EXTENDED } from '../../support/extended.js';
import { resolveTsc } from '../../support/tsc.js';

const TSC = EXTENDED ? resolveTsc() : null;
const runtimeDir = join(import.meta.dir, '../../../src/runtime');

const UNDECLARED = `
type IsAny<T> = 0 extends 1 & T ? true : false;
export type Undeclared<I, D> = {
  [K in keyof I & string]: K extends keyof D
    ? IsAny<D[K]> extends true ? never
      : IsAny<I[K]> extends true ? never
      : D[K] extends (...a: never[]) => unknown ? never
      : D[K] extends object
        ? (I[K] extends object
          ? (Undeclared<I[K], D[K]> extends infer R ? (R extends string ? \`\${K}.\${R}\` : never) : never)
          : never)
        : never
    : K
}[keyof I & string];
`;

// One assignment per declared value, so every disagreement reports in one
// run, then the whole module (a name the scan misses still compares), then
// the completeness check.
const probe = (name, text) => [
  `import * as impl from './impl/${name}.js';`,
  `import type * as decl from './decl/${name}.js';`,
  `import type { Undeclared } from './undeclared.js';`,
  ...[...text.matchAll(/^export declare (?:const|function|class) (\w+)/gm)]
    .map(([, n]) => `export const satisfied_${n}: typeof decl.${n} = impl.${n};`),
  `export const satisfied: typeof decl = impl;`,
  `export const declared: [Undeclared<typeof impl, typeof decl>] extends [never] ? true : Undeclared<typeof impl, typeof decl> = true;`,
].join('\n') + '\n';

// `impl/` holds every runtime module (a module's import of a sibling
// resolves to the sibling's JavaScript, declaration or not); `decl/`
// holds one declaration per probe. Returns tsc's diagnostic lines.
const check = (declarations) => {
  const dir = mkdtempSync(join(tmpdir(), 'rip-runtime-decls-'));
  try {
    mkdirSync(join(dir, 'impl'));
    mkdirSync(join(dir, 'decl'));
    for (const f of readdirSync(runtimeDir)) {
      if (f.endsWith('.js')) writeFileSync(join(dir, 'impl', f), readFileSync(join(runtimeDir, f)));
    }
    writeFileSync(join(dir, 'undeclared.d.ts'), UNDECLARED);
    const files = [];
    for (const [name, text] of Object.entries(declarations)) {
      writeFileSync(join(dir, 'decl', `${name}.d.ts`), text);
      writeFileSync(join(dir, `${name}.probe.ts`), probe(name, text));
      files.push(`${name}.probe.ts`);
    }
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        noEmit: true, target: 'es2022', module: 'esnext', lib: ['es2022', 'dom'],
        allowJs: true, checkJs: false, strict: true, noImplicitAny: false,
      },
      files,
    }));
    const r = spawnSync(TSC, ['-p', 'tsconfig.json'], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
    if (r.error) throw new Error(`cannot run tsc at ${TSC} (${r.error.message}) — try re-running \`bun install\``);
    return `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter((l) => l.trim() !== '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const committed = () => Object.fromEntries(
  readdirSync(runtimeDir).filter((f) => f.endsWith('.d.ts'))
    .map((f) => [f.replace(/\.d\.ts$/, ''), readFileSync(join(runtimeDir, f), 'utf8')]),
);

describeExtended('runtime declarations ↔ implementations', () => {
  test('every declaration beside a runtime is satisfied by its JavaScript and declares every export', () => {
    const decls = committed();
    expect(Object.keys(decls).sort()).toEqual(['components', 'duckdb', 'orm', 'reactive', 'schema', 'stdlib']);
    const diagnostics = check(decls);
    expect(diagnostics, diagnostics.join('\n')).toEqual([]);
  }, 120_000);

  // Teeth: each row is a declaration the gate must refuse, with the line
  // tsc reports against it.
  test('a declaration the implementation does not satisfy, or that misses an export, fails', () => {
    const decls = committed();
    const rows = [
      // a declared return the function does not produce
      ['reactive', decls.reactive.replace(
        'export declare const __readonly: <T>(value: T) => Readonly<{ value: T }>;',
        'export declare const __readonly: <T>(value: T) => T;'),
        /The types returned by '__readonly\(\.\.\.\)' are incompatible/],
      // a declared name the module does not export
      ['schema', decls.schema + 'export declare const registerCoercerz: (name: string) => void;\n',
        /Property 'registerCoercerz' is missing/],
      // a declared member the exported object does not carry
      ['orm', decls.orm.replace('plan: () => never;', 'plan: () => never; drop: () => never;'),
        /Property 'drop' is missing in type/],
      // an export the declaration leaves out
      ['schema', decls.schema.replace('export declare const SchemaRegistry: any;\n', ''),
        /Type 'true' is not assignable to type '"SchemaRegistry"'/],
    ];
    for (const [name, text, expected] of rows) {
      expect(text).not.toBe(decls[name]);
      const diagnostics = check({ [name]: text });
      expect(diagnostics.join('\n')).toMatch(expected);
    }
  }, 120_000);
});
