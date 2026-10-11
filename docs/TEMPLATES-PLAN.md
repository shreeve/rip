# Templates — Cleanup Plan

This document plans the cleanup of Rip's template language (the `render`
block of a component): what it means after the cleanup, which layer owns
each decision, and the phases that get there. It is a plan, not a
contract; nothing here is implemented. Status: **in progress** — owner decisions are recorded in
[Owner decisions](#owner-decisions); phase 0 under way.

The evidence comes from a review of `main` (2026-10-10, after `d00d26b5`):
an implementation map of every place that decides what a template token
means, a catalog of the surface and its ambiguities (every row probed),
and a census of what real code writes (medlabs/app, packages/ui, tui,
sites, email).

## Diagnosis

- **No layer owns template structure.** The grammar has only
  `Render → RENDER Block | RENDER Expression` (src/grammar/grammar.rip
  ~975). The lexer (`inRender`, `renderCodeFloor`, `renderParenDepth`),
  the render rewriter (src/render.js, with its own `inRender`) and the
  emitter each decide where a template starts and ends and what a token
  means, and they disagree. An inline `render div "x"` never closes for
  the rewriter, so `p @click` in a later method is rewritten as template.
- **Two definitions of "this arrow opens code."** The lexer treats
  `div ->` as children; src/render.js treats every arrow as code.
- **Block attachment guesses bindings without scope.** `readsAsValue`
  (src/render.js ~337) sees only `:=`/`~=` names, so a module constant
  or an import takes the next indented block as a call argument
  (`link(() => "go")`). The emitter has the real resolver.
- **Most scanner rules serve constructs nobody writes.** The `#id`
  merge, `.a-b` hyphen absorption, custom-element runs, the `else-x`
  exception and the disabled `.` continuation exist only for spellings
  with zero real uses.
- **Hyphenated keys are joined twice**; the render copy lacks the
  ternary guard (`= ok ? a-b : a` emits the string `"a-b"`).
- **Compiler sentinels live in the user namespace.** `__text__`,
  `__clsx`, `__transition__` and `__bind_x__` are minted by the rewriter
  and re-detected by spelling (and one by a zero-width span).
- **The emitter classifies a word along four paths**, with ASCII-only
  regexes (against the one-identifier-vocabulary rule) and four
  component predicates.

Confirmed silent miscompiles, all exit 0, include: `div.p-4` and
`div.w-1/2` as text expressions; `div.hover:bg-red` as invalid
JavaScript; `#todo` comments in a handler becoming `div#todo`;
`title: total#x` emitted verbatim; `@click null` calling the handler with
an argument; `sl-input @sl-change: go` listening for `sl`; `42` or
`div (-> 1)` creating elements named `42`/`1`; `onclick: -> …`
stringifying a function into an attribute; `count = 5` silently
shadowing a member.

## What real code uses

Heavily used, and kept byte-identical: `class:` (string, array,
object), attribute-only lines, `aria-*`/`data-*`, `style:`, explicit
`@ev: handler` (a method name, a paren arrow, a bare arrow), `<=>`,
`ref:`, `if`/`for … in`/`switch`/inline `if … then`/postfix `if`, a tag
with a string argument, bare string and expression lines, child
components and member paths, `slot`, `asChild`, `key:`, bare boolean
props and attributes, `@member` reads.

Never used: bare `.cls`/`#id` lines, `.(…)`, bare `@ev`, event
modifiers, hyphenated or quoted events, custom elements, `tag ->`,
`~transition`, `innerHTML:`. Barely used: `tag.class` (20 lines, sites
demos), `= expr` (3 lines), render locals (1 line).

## Strategy

**Subtraction first, then one template gate, then grammar homes for the
last sentinels.** Remove the unused sugar until the lexer has no render
mode; make src/render.js the single owner of template positions with a
nesting rule that does not depend on bindings; give `= expr` and `<=>`
grammar productions. The emitter keeps sole ownership of what a word
means, because tag-versus-value depends on bindings, which no parser
can see.

Rejected: a grammar-owned template language (bindings decide tag versus
value, implicit calls are token passes, and it would duplicate the
control-flow productions and touch every tree consumer); a classifier
that keeps the sugar (the lexer decides `#`, `.a-b` and `x-y` before any
token pass runs); subtraction alone (it leaves the region leaks and the
binding-guessing block attachment).

## Target specification

| Construct | Meaning |
|---|---|
| `tag`, `tag args…` | An element: a `TEMPLATE_TAGS` name, or a tight-hyphen custom element (`x-icon`) |
| `tag.cls.cls2`, `tag#id` | Classes and id; a selector token holds letters, digits, `-`, `_` |
| `.cls` / `#id` opening a line | An implicit `div` with that class or id |
| A bare `.` line, `. key: v` | An implicit `div` (with attributes) |
| `tag.( a, b )` | Dynamic classes |
| `tag ->`, `tag key: v, ->` | Optional explicit children arrow; the indented block (or a one-line child) is the children either way |
| `~fade` | A transition on a branch root |
| `key: v` | Attribute or property on an element, prop on a component; `null` removes |
| `aria-*`, `data-*` keys | Joined by `tagCompoundKeys` only |
| `class:`, `style:` | Unchanged |
| A string (argument or line) | Static text |
| `= expr` | The one explicit text form |
| A bound word or expression | Text |
| An unbound plain word | Boolean attribute (element) or prop (component) |
| `@name: handler` | Listener; the value is a function, called with the event |
| `innerHTML:` | Raw HTML for trusted content |
| `key <=> target` | Two-way binding |
| `ref:` | Element reference |
| `key:` | Reconcile key on the first element of a `for` body |
| `if`/`else`/`unless`/postfix `if`/`switch`/`when`/`then`/`for x, i in xs` | Unchanged |
| `name = expr` at a line start | Render local |
| Components | PascalCase, member paths with a PascalCase leaf, `slot`, `@children`, `asChild`, `extends` |
| An indented block | Children of the line's first element — always |

**Positions.** Code: bracket groups, every function body, pair values,
control-flow conditions, the right side of a render local, the body of
`= expr`, interpolations. Template: template line heads, the depth-0
arguments of a template line, positions after `then`/`else` on an
inline branch.

**Characters.** `-` is subtraction in code; a tight `a-b:` key joins;
a tight `word-word` in a template position is a custom element; in an
event position it is part of the event name. `@word` is `this.word` in
code; in a template position only `@word:` (a listener) is legal. `/` is division. `#` is an id tight after a
tag or selector chain or opening a line; anywhere else a comment. `.` is
a class tight after a tag or opening a line; anywhere else member
access. A bare word means: bound → value, tag → element, uppercase
initial → component, else attribute; literals are text. `=` opens text at a
line head and declares a render local as `name =`. `:` separates a key;
on a native element a function value for a non-`@` key or an `on*:` key
rejects. `->` is always a function; as a template argument it rejects.
`~` rejects in a template position.

**Removed, rejecting positioned with the explicit form:** bare `@event`
(write `@event: handler`). Event modifiers stay unsupported, with a
rejection that shows the handler form. Selector classes that need `/`,
`:` or `[` reject, pointing at `class: '…'`.

**Kept and fixed** (the owner's call: these read clearly; their bugs come
from where they are decided, not from what they mean): dynamic classes
`.( )`, bare `.` lines, the `->` children arrow, and `~` transitions.
Each applies only in a template position; in code, `.` is member access,
`->` a function and `~` bitwise not. The lone `.` line with children,
which fails to parse today, is fixed.

## Ownership

| Decision | Owner |
|---|---|
| Render region, code vs template position, nesting, position rejections | src/render.js — one gate |
| Shape of `= expr` and `<=>` | the grammar |
| Hyphenated keys | `tagCompoundKeys` |
| Word meaning, bindings, attributes, serialization | the emitter — one word classifier |
| Tag vocabulary | src/dom.js |
| Component-name rule, identifier tests | src/ident.js |

The lexer ends with no render state.

## Phases

Each phase lands on its own, with editor-grammar updates and a bundle
regeneration where it changes the surface.

| Phase | Scope | Output change | Risk |
|---|---|---|---|
| P0 Safety nets | Byte pins for every heavily used construct; an identity scan (JS and typed face) over the repo and medlabs, with a recorded baseline; re-run every review probe | None | None |
| P1 Event spelling | Remove bare `@event`; the event-modifier rejection shows the handler form | Corpus rows using bare `@event`, enumerated | Low |
| P2 Render-agnostic scanner | Selector (`tag.cls`, `#id`), custom-element and event-name runs become one gate-owned token kind; `else-x` and the lexer render state go; `.` continuation restored in code | Corpus, enumerated | Medium |
| P3 One template gate | One region, code/template classification, all position rejections | None in the scan | Medium–high |
| P4 Binding-free block attachment | The block always belongs to the line head; delete `readsAsValue` | None in the scan | **High** — cold review before merge |
| P5 Grammar homes | `= expr` and `<=>` productions; the sentinels leave the user namespace | Typed face and mapping, enumerated | Medium–high |
| P6 One word classifier | Merge the four emitter paths; void elements, `Component.lower`, literal lines, `on*:` keys, write guards, `ref:` in `for` | None in the scan | Medium |
| P7 Events, bindings, text | Hyphenated event names in listener keys, DOM-event case check, literal handlers reject, `<=>` into loop-row fields notifies, no "null"/"undefined" on the page (text, attributes, properties, template interpolation) | Enumerated (text slots and interpolation change bytes) | Medium |
| P8 Reference and certification | The template chapter of the reference; close PROBLEMS.md entries; full gates; cold review | — | — |

Out of scope: reactivity semantics (T7, T8, T19), component method
binding (T4), member initialization order (T18).

## Owner decisions

Decided with the owner on 2026-10-10; the specification and phases above
reflect them.

1. **`tag.class` selectors stay** and are fixed: a selector is one token,
   tight after a tag, holding letters, digits, `-` and `_` (`div.p-4`,
   `div.col-span-2` work). A class that needs `/`, `:` or `[`
   (`w-1/2`, `hover:bg-red`, `w-[10px]`) rejects, positioned, pointing at
   `class: '…'`.
2. **`#id` stays**: tight after a tag or selector chain, or opening a
   line (`#main`). `#` anywhere else is a comment.
3. **`= expr` stays** as the explicit text form.
4. **Bare `@foo` is removed** — `button @click` and `button @escape`
   reject, naming the explicit form `@click: onClick`. One spelling per
   listener (rule 5), as RFC 3 chose for component events; the ui
   package already names methods `onMousedown` and still writes
   `@mousedown: onMousedown`. In an explicit listener key the event name
   runs through tight hyphens: `@sl-change: go` listens for `sl-change`.
   Event modifiers (`@click.prevent:`) stay unsupported; the rejection
   shows the handler form, `(e: Event) -> e.preventDefault()`.
5. **Handler values keep their meaning** — a function value called with
   the event (`@keydown: note('outer')` stays legal). Literal handlers
   (`@click: "go()"`, `@click: 5`, `@click: null`) reject.
6. **Hyphenated event names work unquoted** in explicit listeners (see
   4); event names are checked against the DOM event list
   case-insensitively, so `@dblClick` rejects with "did you mean
   `@dblclick`".
7. **An uppercase first letter means a component**, all-caps included
   (`QR`, `URL`); no HTML or SVG tag starts uppercase.
8. **A render local that reuses a member's name rejects**, positioned.
9. **`innerHTML:` stays**, documented as a raw-HTML sink for trusted
   content.
10. **A template never shows "null" or "undefined" on the page.** Text
    in every form (bare argument, own-line expression, `= expr`) renders
    them as `""`; an attribute whose value is `null` or `undefined` is
    removed; a property such as `value` or `textContent` receives `""`;
    and every string interpolation inside a template — in text and in
    attribute values (`title: "Hi #{name}"`) — renders them as `""`.
    Every other value renders as `String(value)`. Strings outside
    templates are unchanged; a string already built elsewhere arrives as
    built.
11. **Custom elements stay**: a tight-hyphen word in a template position
    is an element; in code it is subtraction. One gate decides which.

## Verification

Every phase: `bun run test:rip`, `bun run test`, `bun run corpus` with
the diff enumerated, the parser regeneration canary, the P0 identity
scan over the repo and medlabs (no change outside the phase's
enumerated list; baseline failures fail the same way), and
`bun run browser`. P1–P3 also run the three editor-grammar suites;
P2, P5 and P6 run `bun run audit`; P1 and P4 run `bun run test:browser`;
P3, P4 and P6 run the tui and ui package suites. An independent
verifier reproduces each phase's diff; a cold reviewer reviews P4
before it merges and the full series at the end; `bun run test:all`
runs once on the frozen candidate.
