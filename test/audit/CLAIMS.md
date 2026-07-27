# Corpus claims — coverage with no syntactic denominator

The decision record for what the corpus must exercise where no instrument can derive a denominator: checker BEHAVIORS (narrowing, inference enforcement — semantics with no token or production to count) and CONTAINMENT cells (construct-inside-construct shapes the context-free grammar gate cannot distinguish). Type kinds do NOT live here: the gate's census enumerates TS's own type grammar as a closed denominator and queues every unclaimed kind itself. The gate joins this file live, the manifest pattern applied to semantics: a behavior whose carrier is missing paints red, a containment cell no fixture satisfies paints red — so a claim cannot rot silently when a fixture is edited. Rows are added by ruling, never by script; the twin/verdict dimensions hold each carrier's semantic half.

A carrier is `fixture:symbol` — the fixture file and a symbol the gate verifies still exists in it, resolved against any corpus bucket, so a claim's fire side names its error-lane carrier. ABSENT is a ruled claim not yet carried: it paints yellow on purpose, the queue's memory, exactly like a parked production.

## Behaviors

### Inference and enforcement

| behavior | carrier | negative carrier |
| --- | --- | --- |
| an inferred binding is enforced at reassignment (`total = 'oops'` after number) | 20-inference.rip:ledger | 20-inference.errors.rip:tally |
| arithmetic infers through operators — a number-by-number product types number | 20-inference.rip:area | 20-inference.errors.rip:wrongProduct |
| lib-generic results carry instantiated element types (`map`/`filter`/`reduce`, including the point-free spelling) | 20-inference.rip:summed | 20-inference.errors.rip:wrongElements |
| contextual typing reaches an unannotated callback parameter — no implicit any inside `map` | 20-inference.rip:formatted | 20-inference.errors.rip:wrongCallback |
| an unannotated def's inferred return is enforced at its call sites | 20-inference.rip:magnify | 20-inference.errors.rip:wrongReturn |
| a branch-written top-level binding types later same-scope reads (evolving let, no def involved) | 20-inference.rip:tideline | 20-inference.errors.rip:wrongBranch |
| an evolving let read by a hoisted def types through the pin pass | 08-functions.rip:formatOf | — |
| a block-confined evolving let types through the pin pass — a branch-written binding read by a def above its own statement | 20-inference.rip:recount | 20-inference.errors.rip:wrongHoisted |
| a destructured binding types through the pin pass — the same hoisted read, bound by a pattern rather than assigned | ABSENT | ABSENT |
| destructured bindings carry their source property's type, enforced at use | 20-inference.rip:introduceAll | 20-inference.errors.rip:wrongDestructured |
| a write-only binding hovers its value type, never `any` | 01-basics.rip:recorded | — |
| call arity survives paren injection — the implicit spelling is checked like the explicit one | 02-operations.rip:quiet | ABSENT |

### Checker behaviors

| behavior | carrier | negative carrier |
| --- | --- | --- |
| the excess-property check fires on a fresh object literal | 21-checking.rip:inheritedPlacard | 21-checking.errors.rip:wrongExcess |
| the weak-type rule: `{}` satisfies an all-optional type, a literal carrying only unknown keys rejects | 21-checking.rip:noKnobs | 21-checking.errors.rip:wrongKnobs |

### Narrowing

| behavior | carrier | negative carrier |
| --- | --- | --- |
| switch on a union discriminant narrows the arm (`.radius` safe in the `circle` case) | 21-checking.rip:spanOf | 21-checking.errors.rip:wrongSwitchArm |
| a union companion narrows per discriminant across an else-if chain and a loop body | 21-checking.rip:notes | 21-checking.errors.rip:wrongChainArm |

### Type-vocabulary behaviors

The census owns which type KINDS the corpus claims; these rows own what the checker does with them.

| behavior | carrier | negative carrier |
| --- | --- | --- |
| tuple positional typing at access sites — each index reads its own member type | ABSENT | ABSENT |
| a recursive alias resolves and checks a deep literal | ABSENT | ABSENT |
| an index signature admits extra keys while its named members stay required | ABSENT | ABSENT |
| a deep mismatch positions on the inner member, not the outer binding | ABSENT | ABSENT |
| interface heritage demands both base and derived members | ABSENT | 11-types.errors.rip:wrongStrobe |
| `typeof` widens literal properties — a `typeof defaults` alias types string, not `'dark'` | 11-types.rip:tuned | ABSENT |
| overload resolution picks the matched signature's return, where the overloads' returns differ | ABSENT | ABSENT |
| generic call-site inference preserves literal types and enforces the constraint | ABSENT | ABSENT |
| a union-with-`undefined` member demands its key where `?:` does not | ABSENT | ABSENT |
| a nullable-union TARGET accepts each arm and rejects outside them — a string-or-`undefined` and a number-or-`null` binding, where those arms meet strict-null checking | ABSENT | ABSENT |

### Functions and async

| behavior | carrier | negative carrier |
| --- | --- | --- |
| dammit-await types as the awaited value, and a `Promise<T>` annotation validates an async body | ABSENT | ABSENT |
| a fat arrow with an explicit return type emits inline and enforces that return | ABSENT | ABSENT |
| prototype augmentation (`String::titleCase: () => string = -> …`) types the write, the call sites, and hover | ABSENT | ABSENT |

### Modules

| behavior | carrier | negative carrier |
| --- | --- | --- |
| an imported def's type governs the importer's call sites, and the rejection lands on the importing line | ABSENT | ABSENT |
| a missing module specifier publishes cannot-find-module | — | ABSENT |

### Components — the consumer face

| behavior | carrier | negative carrier |
| --- | --- | --- |
| member-kind faces reached through an instance: `=!` rejects writes, `:=` exposes `.value`, `~=` computes, `=` stays plain | ABSENT | ABSENT |
| method faces: typed parameters keep their types, defaulted parameters become optional | ABSENT | ABSENT |
| `component extends <tag>` forwards use-site intrinsics typed from the element | ABSENT | ABSENT |
| a literal-union prop keeps its union at the use site rather than widening to its base type | ABSENT | ABSENT |
| a generic component's constraint violation rejects at the use site | ABSENT | ABSENT |
| ref-cell nullability: a non-nullable cell rejects, an Element-or-null cell accepts any tag | ABSENT | ABSENT |
| a render-head typo beyond `if` (unless, switch, for, `=`) rejects at the head line | ABSENT | ABSENT |
| a wrong-typed write to component state inside a method rejects, while the legal write types | ABSENT | ABSENT |
| array-typed reactive state keeps its ELEMENT type through the cell — `string[] := [...]` rejects a number element and types a read | ABSENT | ABSENT |
| a forwarded element ref — a child `ref:` into a `<=>` bound parent cell — checks end to end | ABSENT | ABSENT |
| indented alias method members enforce their call arguments | ABSENT | ABSENT |

### Schema

| behavior | carrier | negative carrier |
| --- | --- | --- |
| a schema-array field projects nested companions, and a deep read types the leaf | ABSENT | ABSENT |
| a plain datetime field projects Date, and parse coerces an ISO string | ABSENT | ABSENT |
| a callable body is sub-compiled rip and runs | ABSENT | ABSENT |
| a schema companion resolves inside generic type arguments (`Promise<Person>`) | ABSENT | ABSENT |

## Parked

A ruled row is uncarried for one of two reasons, and ABSENT alone cannot tell them apart: nobody has authored the fixture yet, or a DEFECT makes the shape unable to enter a positive fixture at all — the `strict` dimension or `verdict` would reject it, so authoring cannot clear the row until the defect closes. Parked rows are the second kind, netted out of the queue so its count means work available rather than work available plus work impossible. A park names the row verbatim, so the gate can join it live.

The park expires in one direction: the row becomes CARRIED. The gate paints red then, and red for a park naming no row at all, so a park cannot quietly shrink the queue forever.

| behavior | until |
| --- | --- |
| a destructured binding types through the pin pass — the same hoisted read, bound by a pattern rather than assigned | the open destructured-hoisting finding closes (FINDINGS.md) — the pin pass reaches a plainly-assigned binding but not one bound by a pattern, so the shape is implicitly `any` under strict |

## Containment

| construct | inside |
| --- | --- |
| switch | render |
| for-in | render |
| if | render |
