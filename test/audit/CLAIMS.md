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
| a destructured binding types through the pin pass — the same hoisted read, bound by a pattern rather than assigned | 20-inference.rip:mediaType | 20-inference.errors.rip:wrongPatternHoisted |
| destructured bindings carry their source property's type, enforced at use | 20-inference.rip:introduceAll | 20-inference.errors.rip:wrongDestructured |
| a write-only binding hovers its value type, never `any` | 01-basics.rip:recorded | — |
| call arity survives paren injection — the implicit spelling is checked like the explicit one | 02-operations.rip:quiet | 02-operations.errors.rip:wrongArityBare |

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
| tuple positional typing at access sites — each index reads its own member type | 22-vocabulary.rip:axisPair | 22-vocabulary.errors.rip:wrongAxis |
| a recursive alias resolves and checks a deep literal | 22-vocabulary.rip:canopy | 22-vocabulary.errors.rip:wrongTwig |
| an index signature admits extra keys while its named members stay required | 22-vocabulary.rip:counters | 22-vocabulary.errors.rip:wrongTallies |
| a deep mismatch positions on the inner member, not the outer binding | 22-vocabulary.rip:packed | 22-vocabulary.errors.rip:wrongCrate |
| interface heritage demands both base and derived members | 11-types.rip:alarm | 11-types.errors.rip:wrongStrobe |
| `typeof` widens literal properties — a `typeof defaults` alias types string, not `'dark'` | 11-types.rip:tuned | 11-types.errors.rip:wrongPreset |
| overload resolution picks the matched signature's return, where the overloads' returns differ | 22-vocabulary.rip:overloadPair | 22-vocabulary.errors.rip:wrongOverload |
| generic call-site inference preserves literal types and enforces the constraint | 22-vocabulary.rip:narrowed | 22-vocabulary.errors.rip:wrongEcho |
| a union-with-`undefined` member demands its key where `?:` does not | 22-vocabulary.rip:optionality | 22-vocabulary.errors.rip:wrongFirm |
| a nullable-union TARGET accepts each arm and rejects outside them — a string-or-`undefined` and a number-or-`null` binding, where those arms meet strict-null checking | 22-vocabulary.rip:nullables | 22-vocabulary.errors.rip:wrongDrift |

### Functions and async

| behavior | carrier | negative carrier |
| --- | --- | --- |
| dammit-await types as the awaited value, and a `Promise<T>` annotation validates an async body | 23-functions.rip:harvested | 23-functions.errors.rip:wrongPromised |
| a fat arrow with an explicit return type emits inline and enforces that return | 23-functions.rip:doubler | 23-functions.errors.rip:wrongArrow |
| prototype augmentation (`String::titleCase: () => string = -> …`) types the write, the call sites, and hover | 23-functions.rip:titled | 23-functions.errors.rip:wrongTitled |

### Modules

Neither module behavior is a row, and one constraint explains both: no error fixture here imports anything, and none can. The two judges resolve different workspaces — the editor side sees only the flat fixture copies, the twin side only its own `errors/` twins — so no specifier resolves for both at once ([10-modules.errors.rip](corpus/errors/10-modules.errors.rip) states the constraint at the lane). That rules out a missing-specifier negative and a wrong-use-of-an-import negative alike.

What that costs is FALSIFIABILITY, not coverage. 10-modules.rip imports across every specifier form and `verdict` holds it, so the corpus does show that imports resolve and type-check. It cannot show that an imported type is ENFORCED: driven 2026-07-28, retyping the lib's `port` export to `any` leaves all five dimensions green on all four module fixtures, because a positive demands zero published diagnostics and `any` publishes none. An enforcement claim is only ever held by a negative, so these stay notes — a carried row here would count toward the corpus's coverage while proving nothing.

### Components — the consumer face

| behavior | carrier | negative carrier |
| --- | --- | --- |
| member-kind faces reached through an instance: `=!` rejects writes, `:=` exposes `.value`, `~=` computes, `=` stays plain | 25-components.rip:meterWidth | 25-components.errors.rip:Gauge |
| method faces: typed parameters keep their types in both member layouts (inline body and indented body), defaulted parameters become optional | 25-components.rip:tallied | 25-components.errors.rip:wrongStep |
| `component extends <tag>` forwards use-site intrinsics typed from the element | 25-components.rip:Prompt | 25-components.errors.rip:Swatch |
| a literal-union prop keeps its union at the use site rather than widening to its base type | 25-components.rip:Ribbon | 25-components.errors.rip:Tint |
| a generic component's constraint violation rejects at the use site | 25-components.rip:Palette | 25-components.errors.rip:Palettes |
| ref-cell nullability: a non-nullable cell rejects, an Element-or-null cell accepts any tag | 25-components.rip:Anchors | 25-components.errors.rip:Shell |
| a render-head typo beyond `if` (unless, switch) rejects at the head line, on the NAME | 13-components.rip:Roster | 13-components.errors.rip:Heads |
| a wrong-typed write to component state inside a method rejects, while the legal write types | 25-components.rip:Ledger | 25-components.errors.rip:Books |
| array-typed reactive state keeps its ELEMENT type through the cell — `string[] := [...]` rejects a number element and types a read | 25-components.rip:ledgerHead | 25-components.errors.rip:Books |
| a forwarded element ref — a child `ref:` into a `<=>` bound parent cell — checks end to end | 25-components.rip:Cuff | 25-components.errors.rip:Liner |

### Schema

| behavior | carrier | negative carrier |
| --- | --- | --- |
| a schema-array field projects nested companions, and a deep read types the leaf | 26-schema.rip:leafPort | 26-schema.errors.rip:wrongLeaf |
| a plain datetime field projects Date, and parse coerces an ISO string | 26-schema.rip:minted | 26-schema.errors.rip:wrongStamp |
| a callable body is sub-compiled rip and runs | 26-schema.rip:parcel | — |
| a schema companion resolves inside generic type arguments (`Promise<Person>`) | 26-schema.rip:fetched | 26-schema.errors.rip:wrongPromise |

## Parked

A ruled row is uncarried for one of two reasons, and ABSENT alone cannot tell them apart: nobody has authored the fixture yet, or a DEFECT makes the shape unable to enter a positive fixture at all — the `strict` dimension or `verdict` would reject it, so authoring cannot clear the row until the defect closes. Parked rows are the second kind, netted out of the queue so its count means work available rather than work available plus work impossible. A park names the row verbatim, so the gate can join it live.

The park expires in one direction: the row becomes CARRIED. The gate paints red then, and red for a park naming no row at all, so a park cannot quietly shrink the queue forever.

| behavior | until |
| --- | --- |

## Containment

| construct | inside |
| --- | --- |
| switch | render |
| for-in | render |
| if | render |
