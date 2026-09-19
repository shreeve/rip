// The TypeScript API surface `rip check --public` depends on, named as a
// contract.
//
// That audit reads types from the checker through `typescript/unstable/*`.
// The path segment is the compatibility promise: there is none. This gate
// spells out every member the walk touches so a TypeScript upgrade that
// moves one fails here, naming it, rather than somewhere downstream where a
// missing method reads as a type with no signatures — which the audit would
// report as a clean public surface.
//
// Shape only, and no server is started: behavior is proven by the
// `--public` cases in test/spawn/cli/check.test.js, which drive the real
// checker end to end.
import { test, expect } from 'bun:test';
import fs from 'node:fs';
import * as api from 'typescript/unstable/async';

// The session layer — how a project is reached. Newest, and the likeliest
// to move: nothing in TypeScript's long-published API looks like this.
// `dispose` is called as `dispose?.()`, so a rename would not throw — it
// would silently stop releasing snapshots, with no signal at all.
const SESSION = { API: ['updateSnapshot', 'close'], Snapshot: ['getDefaultProjectForFile', 'dispose'], Program: ['getSourceFile'] };

// The checker itself. These names are the classical `ts.TypeChecker`
// spelling and have outlived many major versions.
const CHECKER = [
  'getSymbolAtLocation', 'getTypeOfSymbol', 'getDeclaredTypeOfSymbol', 'getAliasedSymbol',
  'getSignaturesOfType', 'getReturnTypeOfSignature', 'getPropertiesOfType', 'typeToString',
  // What a type CONTAINS, where a consumer's own bindings are found, and
  // the resolved export table that follows `export *`.
  'getIndexInfosOfType', 'getTypeArguments', 'isArrayType',
  'resolveName', 'getReferencesToSymbolInFile', 'getExportsOfModule',
];

const SYMBOL = ['getExports'];
const SIGNATURE = ['getParameters'];

// The list is DERIVED from the walk, not maintained beside it: a hand copy
// drifts the moment a call is added, and the drift is invisible because the
// gate keeps passing on the members it still knows about.
//
// It must also fail CLOSED. Reading the source for a spelling means a local
// rename can make the derived set empty, which looks exactly like a passing
// gate — so the count is asserted too. That number is a floor, not a pin: it
// rises when the walk calls something new, and the fix is to add the name.
test('the pinned list covers every checker member the walk actually calls', () => {
  const src = fs.readFileSync(new URL('../../packages/vscode/src/publicwalk.js', import.meta.url), 'utf8');
  const called = [...new Set([...src.matchAll(/\bck\.([a-zA-Z][A-Za-z0-9]*)\s*\(/g)].map((m) => m[1]))].sort();
  expect(called.length, 'derived no checker calls at all — the walk renamed its checker binding, '
    + 'so this gate stopped looking rather than started passing').toBeGreaterThanOrEqual(12);
  const unpinned = called.filter((m) => !CHECKER.includes(m));
  expect(unpinned, `publicwalk.js calls checker members this gate does not pin: ${unpinned.join(', ')}`).toEqual([]);
});

test('the checker methods the public audit calls all exist', () => {
  const proto = api.Checker?.prototype ?? {};
  const missing = CHECKER.filter((m) => typeof proto[m] !== 'function');
  expect(missing, `typescript ${api.version ?? ''} moved checker members: ${missing.join(', ')}`).toEqual([]);
});

test('the session layer that reaches a project still exists', () => {
  for (const [cls, members] of Object.entries(SESSION)) {
    const proto = api[cls]?.prototype ?? {};
    const missing = members.filter((m) => typeof proto[m] !== 'function');
    expect(missing, `${cls} moved: ${missing.join(', ')}`).toEqual([]);
  }
  // A Project hands over its checker and program as properties, not calls.
  const names = Object.getOwnPropertyNames(api.Project?.prototype ?? {});
  expect(api.Project, 'Project class is gone').toBeDefined();
  expect(names.includes('constructor')).toBe(true);
});

test('symbol and signature members the walk reads still exist', () => {
  const symProto = api.Symbol?.prototype ?? {};
  expect(SYMBOL.filter((m) => typeof symProto[m] !== 'function')).toEqual([]);
  const sigProto = api.Signature?.prototype ?? {};
  expect(SIGNATURE.filter((m) => typeof sigProto[m] !== 'function')).toEqual([]);
});

// Flags are compared by VALUE, so a renumbering is as breaking as a rename
// and far quieter: `TypeFlags.Any` reading the wrong bit turns every `any`
// into a clean answer. These values are pinned, not merely required to
// exist.
test('the enum members the walk tests are present, and their values are pinned', () => {
  expect(api.TypeFlags.Any).toBe(1);
  expect(api.SignatureKind.Call).toBe(0);
  expect(api.SignatureKind.Construct).toBe(1);
  const flags = {
    Alias: 2097152, Interface: 64, TypeAlias: 524288, Variable: 3, Function: 16,
    Class: 32, Enum: 384, ValueModule: 512, Method: 8192, Property: 4, ExportStar: 8388608,
  };
  for (const [name, value] of Object.entries(flags)) {
    expect(api.SymbolFlags[name], `SymbolFlags.${name} changed value`).toBe(value);
  }
});
