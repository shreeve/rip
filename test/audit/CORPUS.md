# Corpus — charter and authoring conventions

The law no gate checks and no source states: what earns a fixture, where it goes, and the register. What a gate enforces is stated where the gate is; completeness is measured live (`bun run audit`), never recorded here.

## Charter

**Claims are tests, populations are the audit.** A test asserts one claim and must be green; the audit measures a population against a denominator and may be red. A lone reproducible defect with a known-correct answer belongs in a test — the audit's job is to find it, not hold it.

**A census yields candidates, not obligations.** The battery owns behavior and emitted bytes, `test/lang` and `test/schema` own the face's text; this corpus owns whether the face type-checks and answers. Only a gap in that last question earns a fixture — `::` is the worked example: emission and decline classes were already gated in the battery, leaving only the call sites and hover to this corpus.

**Where no syntactic denominator exists, a registry replaces it, by ruling.** Checker semantics rule into CLAIMS.md before a fixture exists; interaction shapes are ruled cells against the containment matrix; the schema body is pins-or-nothing under RULINGS.md. Runtime behavior is out of scope — the battery owns it.

**Placement.** A production is covered in the file of the construct it carries, never its left-hand side's family: `Expression → Gate` is 13-components' because covering it means writing a component, and export-of-reactive is 12-reactive's because covering it means writing reactive code. Ties break toward the earlier file. Ownership is recorded nowhere — the fixture that reduces a production is its owner.

**Numbering.** The grammar bucket numbers from 01, the claims bucket from 20; basenames stay unique corpus-wide.

**The app bucket.** `corpus/app/` is an app-shaped tree — `index.rip` and `package.json` at its root, `app/stash.rip`, routes under `app/routes/` — because the editor anchors a stash to the nearest directory holding both root files, and the gate rows' typed arm exists only where a stash is discovered. It is its own workspace root for the lanes that take one (the sweep, the landing, the round-trip); the flat probe passes do not enter it. A fixture there carries the shapes only a stash makes real: every gate form, the `@app` and `@router` reads, the router's typed ambience.

**The corpus retires.** A fixture whose productions the rest already cover is removable — the unique-contribution line names it.

## Comments

No sentence spans two lines. A header is one line. A note is one line at the shape it concerns and exists only where the construct is written oddly, or is absent, because of an open defect. A comment earns its place by stating what no instrument can — never a lowering the twin states, a byte pin, or a fixed defect. A property a later author could quietly break becomes a battery byte pin, not a warning.

## Register

Explicit call parens (the implicit spelling lives densely in 02-operations), single quotes unless interpolation forces double, padded braces on inline object and type literals in both pair members, negatives in the family's error fixture and never inline, `wrong*` names as full words with a blank line separating them from setup. Density follows starvation: grammar-dark families get minimal-honest coverage, shape-starved ones (components, schema) get dense, real-shaped content.

## Twins

Written with the fixture, standard-TS-formatted, never line-parity: correspondence is by construct order and symbol name, the fixture is never edited for the twin's sake, and the twin running longer is fine. Error pairs alone are strictly line-aligned and change header length together. Diagnostics derive from the twin wherever it can judge; pins only where it cannot. The reactive twin spells value types (`:=` → `let`, `~=`/`=!` → `const`) — except the error pair's two initializer lines, which spell the lowering's own call, because a plain declaration models a different relation and blames the name. Analogy twins (13-components: TSX, 14-schema: zod) reach only where the analogy is honest; where a write re-fires an effect, the twin hand-replays the flush.
