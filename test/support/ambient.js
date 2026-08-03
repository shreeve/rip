// The feature-runtime names, ambient-declared for the tsc-backed face gates.
//
// Those gates compile under runtimeDelivery 'none', so the artifact under
// validation is the FACE and not the runtime bodies — but a face still spells
// the primitives, so something has to declare them.
//
// Each name carries the SIGNATURE the inline delivery's own cast asserts, read
// from the compiler's RUNTIME_TABLE rather than copied here. That is not tidiness:
// an annotated reactive's face spells `__state<number>(v)`, an explicit type
// argument, and a callee declared `any` REJECTS one — TS2347, "untyped function
// calls may not accept type arguments." So declaring these `any` does not make
// the harness more permissive than the shipped face, it makes it reject faces the
// shipped face accepts, and the gate fails on programs that are actually fine.
// Reading the real types keeps the harness's environment the one a compiled
// program gets.
//
// The NAME set stays curated and is deliberately NARROWER than the table: the
// feature runtimes (reactive, schema, the M12 component family) and not the
// stdlib, so a fixture that leans on `p` or `zip` without delivering them is
// still caught. Names the table types nothing for fall back to `any` — the face
// never depends on their shape.
import { _runtimeTable } from '../../src/emitter.js';

const NAMES = [
  '__state', '__computed', '__effect', '__batch', '__readonly',
  '__setErrorHandler', '__handleError', '__catchErrors', 'getEffectSignal',
  '__schema', 'SchemaError', 'registerCoercer',
  '__Component', '__pushComponent', '__popComponent', 'setContext',
  'getContext', 'hasContext', '__clsx', '__lis', '__reconcile',
  '__transition', '__handleComponentError', '__detach', '__ownerFrame',
  '__pushOwner', '__popOwner', '__detachRef',
];

// name → face type, unioned across the table's runtimes.
const TYPES = new Map();
const KNOWN = new Set();
for (const rt of _runtimeTable()) {
  for (const name of rt.names) {
    KNOWN.add(name);
    if (rt.types?.[name]) TYPES.set(name, rt.types[name]);
  }
}

// A curated name the compiler no longer delivers would be declared here and
// nowhere else — the face would compile against a symbol that does not exist,
// and the gate would go on passing. Fail loudly at import instead.
const stale = NAMES.filter((n) => !KNOWN.has(n));
if (stale.length > 0) {
  throw new Error(
    `test/support/ambient.js declares runtime name(s) the compiler no longer delivers: ${stale.join(', ')}`,
  );
}

export const AMBIENT =
  `declare const ${NAMES.map((n) => `${n}: ${TYPES.get(n) ?? 'any'}`).join(', ')};\n`;
