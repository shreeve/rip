# TODO — Rip

Open work only. Delete a line when it lands or moves into docs/tests.

## Bugs from the lexer-pass mutation triage

Each has a minimal repro in the triage ledgers (reimagine/mutation/).
None is a silent miscompile; the six that were landed in #504.

- Render: `span -> x-icon` compiles to the text `String(x - icon)`, which
  throws at runtime; it should mount an `x-icon` child, as `span -> p`
  mounts a `p`.
- Render: a child-position `#x: "a"` compiles to an invalid
  `setAttribute('div#x', …)`; it should reject, positioned.
- Types: a property write (`o.x = 1`) counts as evidence that `x` is
  assigned, so a lone `x: number` erases as a forward declaration with no
  binding behind it.
- Types: a cast whose closing bracket sits on the next line
  (`a = [x as number` / `]`) rejects; `a = [x` / `]` compiles.
- Types: `def t!: Map<K, V>` with an indented body rejects; `def t!(): …`
  compiles.
- Types: `(@a?) ->` rejects with a message about property names; it
  should be an optional promoted parameter or a precise rejection.
- Types: `type X<T extends A << B> = T` compiles on the JS face; only
  declaration emission rejects it.
- Arrows: `c ? (a) : -> 7` rejects; the arrow walk reads `(a) :` as a
  parameter list with a return type.
- Arrows: `f = (a): T extends U ? X : Y -> a` rejects, though `def`
  accepts the same conditional return type.
- `interface render` (a keyword-spelled name) rejects as "'interface' is
  reserved".
- Implicit objects: `x = [k]: 1` and `x = "a#{b}": 1` reject with
  "Unexpected implicit '{'", though the braced forms compile; `x = {@ a: 1}`
  and `f x: 1,` / `y: g` / `  z: 2` / `, w: 3` reject with messages about
  generated tokens.
- `if xs.every (s) => if s then 1 else 2` + an indented block rejects
  (a leaky pending-block count in implicitBlocks' bodyEnd).
- `h -> g ->` + an indented block (the `describe … it …` shape) rejects.
- Declarations: a multi-line parameter object type with a trailing comma
  emits `{ a: number, ; b: string }`.

## TS face

- Type names the face writes (`HTMLElement`, `Node`, and the rest) can
  be captured by an author's own `type` of the same name: 68 such errors
  in packages/ui. Spell every face-written DOM name through `globalThis`,
  as #502 did for `Node`.

## Kept in view

- Agent review of the riskiest unobserved emitter survivors
  (reimagine/mutation/unobserved.md), if the rebuild gives a reason.
- Split the consumer-corpus gate in test/toolchain/corpus-expected.test.js (about 6 s) into
  shards if the fast loop's wall time starts to matter.
