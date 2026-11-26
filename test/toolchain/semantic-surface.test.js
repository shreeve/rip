// The parser ships its tree contract: `kinds` in the generated module
// is the grammar's kind registry, parsed — every kind with its forms
// (named, typed slots) and side roles. These tests bind the two worlds
// that meet there: the grammar's declared registry above, and the
// compiler's hardcoded kind/role query names below. A grammar rename
// that would orphan a query site fails here instead of returning null
// forever at runtime.
import { test, expect } from 'bun:test';
import { kinds } from '../../src/parser.js';
import { Generator } from '../../src/grammar/solar.rip';
import grammar from '../../src/grammar/grammar.rip';

test('the shipped surface is the declared registry, kind for kind', () => {
  const generated = new Generator(grammar).kindRegistry;
  expect(kinds).toEqual(JSON.parse(JSON.stringify(generated)));
  expect(Object.keys(kinds).sort()).toEqual(Object.keys(grammar.kinds).sort());
  for (const [kind, entry] of Object.entries(grammar.kinds)) {
    expect(kinds[kind].forms.map((f) => f.text), kind).toEqual(entry.forms);
    expect(kinds[kind].side, kind).toEqual(entry.side ?? []);
  }
});

// Every kind the compiler discriminates on via semanticKind.
// Inventory: grep -roE "semanticKind[^=]*===? ?'[a-z-]+'" src src/ts
const KIND_DISCRIMINATORS = [
  'assign', 'class', 'component', 'def', 'effect',
  'func', 'gate', 'import', 'pair', 'readonly',
];

test('every semanticKind the compiler discriminates on exists', () => {
  for (const kind of KIND_DISCRIMINATORS) {
    expect(kinds[kind], `kind '${kind}'`).toBeDefined();
  }
});

// Every role name the compiler queries RoleStore with.
// Inventory: grep -roE "\.role\([^,]+, '[a-zA-Z$]+'\)" src src/ts
const ROLE_QUERIES = [
  'annotation', 'key', 'optionalMarker', 'property', 'target',
  'typeOnly', 'typeParams', 'value', 'vars',
];

test('every role name the compiler queries exists in some kind', () => {
  const allRoles = new Set(Object.values(kinds).flatMap((entry) => [
    ...entry.side,
    ...entry.forms.flatMap((form) => form.slots.filter((slot) => slot.role).map((slot) => slot.role)),
  ]));
  for (const role of ROLE_QUERIES) {
    expect(allRoles.has(role), `role '${role}'`).toBe(true);
  }
});
