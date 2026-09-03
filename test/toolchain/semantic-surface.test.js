// The parser ships its semantic surface: `kinds` in the generated
// module names every kind the annotated rules produce with the role
// vocabulary each may carry, derived from the same semantics table
// the actions populate — in sync with the parse by construction.
// These tests bind the two worlds that meet there: the grammar's
// declared registry above, and the compiler's hardcoded kind/role
// query names below. A grammar rename that would orphan a query site
// fails here instead of returning null forever at runtime.
import { test, expect } from 'bun:test';
import { kinds } from '../../src/parser.js';
import grammar from '../../src/grammar/grammar.rip';

test('the shipped surface is the declared registry, kind for kind', () => {
  const declared = Object.fromEntries(
    Object.entries(grammar.kinds)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, roles]) => [kind, [...roles].sort()]),
  );
  expect(kinds).toEqual(declared);
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
  const allRoles = new Set(Object.values(kinds).flat());
  for (const role of ROLE_QUERIES) {
    expect(allRoles.has(role), `role '${role}'`).toBe(true);
  }
});
