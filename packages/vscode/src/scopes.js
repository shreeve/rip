// The DECLARATION-SCOPE gate: which lines of a .rip source are type-checked
// under gradual annotations.
//
// Gradual mode's rule is one sentence: you get diagnostics where type
// information reaches. A line is checked when it carries type information
// itself, or when type information reaches it along one of the three ways a
// program actually carries it:
//
//   INWARD    indentation — an annotated header checks its body, including
//             nested closures. Never outward from a body: annotating an
//             inner helper leaves its 300-line parent alone.
//   OUTWARD   an annotation in a DECLARATION'S HEADER is an annotation on
//             the declaration, so it types the name and checks the body. A
//             constructor's promoted parameter types its class; a
//             component's annotated member types its view.
//   SIDEWAYS  a use site is a SIBLING of its declaration, not a child, so
//             indentation alone can never reach it. Bindings carry their
//             scope, and type flows along assignment to a fixpoint: `total
//             = count + ratio` off two annotated numbers is a number.
//
// This replaces filtering by diagnostic CODE. A missing annotation is born as
// the implicit-any family but dies fifty lines later as TS2339 on the shape it
// produced, so no per-code filter can be complete; the scope is the honest
// dimension. The same reasoning is why SIDEWAYS reaches a fixpoint rather
// than stopping after one hop — a one-hop gate re-creates the same
// born-here-dies-there hole one line further down.
//
// Two things stay outside the gate:
//
//   - `rip.strict` — a strict project asked for everything, gate included.
//   - ALWAYS_REPORTED — a name or module that does not exist is a bug whether
//     or not the author annotated. This is why the gate is a filter and not
//     the `# @ts-nocheck` directive: the directive is all-or-nothing per file
//     and cannot make this exception.
//
// The question is whether a declaration HAS TYPE INFORMATION, not whether the
// author typed one out. The constructs rip types wholesale — schemas and
// components (COMPILER_TYPED_KINDS) — are checked without a single TYPE
// token, because gating them away would silence exactly the checking rip
// gives for free. Nothing else the emitter writes counts: lowering
// scaffolding and pin annotations are output, not intent.
//
// The gate is FILE-LOCAL. Type information arriving from another module — a
// typed `.rip` export, an installed `@types` package, a workspace `.d.ts` —
// does not switch on the file that imports it; only what this file says
// about itself does. That is a posture, not an oversight, and it is the open
// question this design puts to its reader.
//
// Errs toward MORE checking wherever it is unsure. A binding it cannot place
// keeps whole-file reach; a construct it does not recognize is not treated as
// a scope. False noise is a nuisance the author can answer with an
// annotation; false silence reads as a clean file and cannot be answered at
// all.
//
// Pure: the caller supplies tokens and the face (the extension resolves the
// compiler at runtime and this module must load in both the in-repo and
// staged-vsix layouts).

import path from 'node:path';
import { generatedSpanToSource } from './translate.js';
import { ripSpecifierTarget } from './mirror.js';

// A defect no annotation answers. Reported under every mode — gating one of
// these would hide a real bug behind "gradual mode", and there is no
// annotation the author could have written that makes the program right.
//
// The cannot-find family: a name or module that does not exist. 2552 is 2304
// with a spelling suggestion attached ("Cannot find name 'error'. Did you
// mean 'err'?"): the same defect wearing a different code, and the reason to
// enumerate rather than eyeball. The family is spelled across many codes
// because TypeScript varies the ADVICE, not the defect: a bare miss (2304), a
// spelling suggestion (2552), and two "change your target library" forms
// (2583 for ES built-ins, 2584 for DOM globals) are one diagnostic wearing
// four numbers. Enumerated rather than eyeballed.
//
// The same defect spelled at the MODULE BOUNDARY: importing a member the
// module does not export (2305, and 2724 with a suggestion), a default
// import from a module with no default (2613), and a named import that
// should have been the default (2614). A consumer typo-ing an import name
// wrote a name that does not exist.
//
// The definition cycle (2502): a computed that reads itself, directly or
// through others, recurses forever the first time anyone reads it. An
// annotation would break TypeScript's INFERENCE cycle and so silence the
// code — while leaving the runtime cycle exactly where it was. A diagnostic
// an annotation silences without fixing belongs outside the gate.
//
// The import write (2632): assigning to an imported binding is a runtime
// TypeError under ESM — the bundler refuses it too — and no annotation in
// either module changes that.
export const ALWAYS_REPORTED_CODES = new Set([
  2304, // cannot find name
  2305, // module has no exported member
  2307, // cannot find module
  2502, // referenced directly or indirectly in its own definition
  2503, // cannot find namespace
  2552, // cannot find name — did you mean 'Y'?
  2583, // cannot find name — change your target library (ES built-in)
  2584, // cannot find name — change your target library (DOM global)
  2613, // module has no default export
  2614, // module has no exported member — did you mean a default import?
  2632, // cannot assign to an import
  2724, // module has no exported member — did you mean 'Y'?
]);

// offset → 0-based line, over one pass of the source. Every pass here works
// in offsets (tokens, node spans, mapped diagnostic positions) and reports in
// lines, so they all cross here.
function lineIndexer(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo;
  };
}

// The 0-based lines carrying a type annotation. `tokens` is the compiler
// lexer's token array; TYPE is the kind every annotation lowers to, which is
// why this reads tokens rather than scanning text — a scan cannot tell the
// annotation `x: T = v` from the object literal `{ x: T }`.
export function annotatedLinesOf(tokens, source) {
  const lines = new Set();
  if (!tokens) return lines;
  const lineAt = lineIndexer(source);
  for (const t of tokens) {
    if (t.kind !== 'TYPE') continue;
    if (typeof t.start !== 'number') continue;
    lines.add(lineAt(t.start));
  }
  return lines;
}

// Per-line gate: 1 where diagnostics are reported, 0 where they are held.
//
// Scope comes from indentation, which in rip IS the block structure: a
// meaningful line opens a scope that runs until the next meaningful line at
// the same or lower indent. A line inherits its enclosing scope's answer, so
// an annotated header checks its whole body without the annotation having to
// repeat. Blank and comment lines inherit the last answer so a diagnostic
// mapped onto one is governed by the code around it.
export function checkedLinesOf(source, annotated) {
  const lines = source.split('\n');
  const out = new Uint8Array(lines.length);
  // A `# @ts-expect-error` / `# @ts-ignore` is itself a statement about
  // types: the author is asserting an error lives on the next line. Both the
  // directive and the line it governs are therefore checked, whatever else
  // is annotated. Gating them instead would suppress the very diagnostic the
  // directive promised to absorb — and then TypeScript's own "unused
  // directive" TS2578, which lands on the comment, would be gated too. The
  // escape hatch would rot silently, which is the one thing it must not do.
  const directive = /^[ \t]*#[ \t]*@ts-(expect-error|ignore)(\s|$)/;
  for (let i = 0; i < lines.length; i++) {
    if (!directive.test(lines[i])) continue;
    annotated.add(i);
    if (i + 1 < lines.length) annotated.add(i + 1);
  }
  const stack = [];
  let last = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) { out[i] = annotated.has(i) ? 1 : last; continue; }
    const indent = line.length - line.trimStart().length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const inherited = stack.length ? stack[stack.length - 1].checked : 0;
    const checked = inherited || (annotated.has(i) ? 1 : 0);
    out[i] = checked;
    last = checked;
    stack.push({ indent, checked });
  }
  return out;
}

// The face's TS-only regions are never type information: every region is
// emitter output — lowering scaffolding (`: void` on a bang-def, arity
// `?`s) and pin annotations — and reading one as an annotation opens
// whole unannotated files and re-admits held inference through pins.
// Author annotations are counted from their TYPE tokens; wholesale-typed
// constructs by KIND (COMPILER_TYPED_KINDS).

// The FUNCTION SCOPES a source declares, as source spans. Read off the parse
// tree rather than re-derived from indentation, because indentation answers a
// different question: it gives the BLOCK structure, and rip's bindings are
// function-scoped, so an `if` body indents without opening a scope.
//
// Only `def` and `func` are taken. Both are unambiguously the scopes rip's
// local bindings live in, and the set is deliberately short: a region named
// here NARROWS a binding's reach, so a wrong entry causes false silence —
// the one failure this design must not have. A construct left out keeps the
// pre-existing whole-file reach, which over-checks and stays safe.
//
// A node's own `name` role is a HOLE in its region: `def filterBy(…)` binds
// `filterBy` in the ENCLOSING scope while its parameters bind inside. Without
// the hole every function name would be invisible at its own call sites, and
// a typed signature would stop checking the calls it exists to check.
export function scopeRegionsOf(stores) {
  const regions = [];
  if (!stores?.nodes) return regions;
  for (const n of stores.nodes) {
    if (!FUNCTION_KINDS.has(n.semanticKind)) continue;
    if (typeof n.sourceStart !== 'number') continue;
    const name = stores.role(n.nodeId, 'name');
    const hole = typeof name?.sourceStart === 'number' ? [name.sourceStart, name.sourceEnd] : null;
    regions.push({ start: n.sourceStart, end: n.sourceEnd, hole });
  }
  return regions;
}

// The node kinds that ARE functions: `def`, and `func` for every lambda
// spelling — parenthesized, bare `->`/`=>`, typed, or not. One set, because
// three passes depend on agreeing about it: scopeRegionsOf (where bindings
// live), declarationHeadersOf (what a header is), and assignmentFlowsOf
// (what a value reads).
const FUNCTION_KINDS = new Set(['def', 'func']);

// Every function in the file with the span of its body, for the passes that
// subtract bodies. `kinds` widens the set where a caller's notion of "body"
// is wider — declarationHeadersOf adds `render`.
export function functionBodiesOf(stores, kinds = FUNCTION_KINDS) {
  const out = [];
  if (!stores?.nodes) return out;
  for (const n of stores.nodes) {
    if (!kinds.has(n.semanticKind) || typeof n.sourceStart !== 'number') continue;
    const body = stores.role(n.nodeId, 'body');
    if (typeof body?.sourceStart !== 'number') continue;
    out.push({ start: n.sourceStart, end: n.sourceEnd, bodyStart: body.sourceStart, bodyEnd: body.sourceEnd });
  }
  return out;
}

// The DECLARATION HEADERS a source spells, each with the span of the name it
// binds. A header is a declaration's span minus every function body nested
// inside it — which is the same subtraction for all four forms and needs no
// per-construct rule:
//
//   def f(x: T)          header = the signature; the body is subtracted
//   class Box            header = the fields and the method SIGNATURES,
//                          including a constructor's promoted parameters
//   X = component        header = the members; `render`'s body is subtracted
//   f = (x: T) ->        header = the parameters
//
// The subtraction is what keeps the rule honest in both directions. An
// annotation in the header is a fact about the declaration ITSELF — its
// call signature, its instance shape, its props — so it types the name and
// checks the body. An annotation in the body is a fact about one local, and
// types neither.
//
// A form's name lives where the form is named: `def`/`class` carry a `name`
// role, while a component or a lambda is named by the `assign`/`pair` that
// binds it. Both are read off the tree; neither is guessed from text.
//
// Each declaration reports its KIND, because two of the kinds are typed
// without any TYPE token — see COMPILER_TYPED_KINDS.
export function declarationHeadersOf(stores) {
  const decls = [];
  if (!stores?.nodes) return decls;
  const KINDS = new Set(['def', 'func', 'class', 'component', 'schema']);
  // Names conferred from outside: `Gotcha = component …` and `go: (n) ->`
  // name a node that carries no name role of its own. Keyed by the named
  // node's span, which is what the naming role's own span points at.
  const conferred = new Map();
  for (const n of stores.nodes) {
    const [valueRole, nameRole] =
      n.semanticKind === 'assign' ? ['value', 'target'] :
      n.semanticKind === 'pair' ? ['value', 'key'] : [];
    if (!valueRole) continue;
    const value = stores.role(n.nodeId, valueRole);
    const name = stores.role(n.nodeId, nameRole);
    if (typeof value?.sourceStart !== 'number' || typeof name?.sourceStart !== 'number') continue;
    conferred.set(`${value.sourceStart}:${value.sourceEnd}`, name);
  }
  // Every function body in the file, subtracted from whichever headers
  // contain it. `render` joins them: a component's view is its body in
  // exactly the sense that matters here — the part an annotation on the
  // component's shape governs rather than the part that spells it.
  const bodies = functionBodiesOf(stores, new Set([...FUNCTION_KINDS, 'render'])).map((b) => [b.bodyStart, b.bodyEnd]);
  for (const n of stores.nodes) {
    if (!KINDS.has(n.semanticKind) || typeof n.sourceStart !== 'number') continue;
    const name = stores.role(n.nodeId, 'name') ?? conferred.get(`${n.sourceStart}:${n.sourceEnd}`);
    if (typeof name?.sourceStart !== 'number') continue;
    const holes = bodies.filter(([s, e]) => s >= n.sourceStart && e <= n.sourceEnd);
    decls.push({ start: n.sourceStart, end: n.sourceEnd, holes, name, kind: n.semanticKind });
  }
  return decls;
}

// Declarations the COMPILER types wholesale, so they are typed with no TYPE
// token anywhere in the source.
//
// A schema's fields are typed in the DSL's own vocabulary — `name! string`
// IS the annotation, spelled the way the construct spells it — and the face
// materializes the story as real declarations: a data type per field, a
// typed factory (`as ModelSchema<…>`), a `this` annotation on every
// callable. A component's members get the same treatment from their
// initializers: a `declare x: {…}` per state, a companion interface, a
// `this` annotation on every computed.
//
// The token scan cannot see any of this — a schema body lexes as one opaque
// SCHEMA_BODY token, and a component's member types exist only in the face —
// so the construct's KIND is the signal: the face types every schema and
// every component by construction, and gating their bodies away would
// silence exactly the checking rip gives for free.
const COMPILER_TYPED_KINDS = new Set(['schema', 'component']);

// True when an offset lies in a declaration's header — inside its span and
// outside every body nested in it.
function inHeader(decl, off) {
  if (off < decl.start || off >= decl.end) return false;
  return !decl.holes.some(([s, e]) => off >= s && off < e);
}

// The innermost scope containing an offset, or null for the whole file. A
// hit inside a region's name hole falls THROUGH to the enclosing scope,
// which is what makes a function's name a binding of its parent.
function scopeAt(regions, off) {
  let best = null;
  for (const r of regions) {
    if (off < r.start || off >= r.end) continue;
    if (r.hole && off >= r.hole[0] && off < r.hole[1]) continue;
    if (!best || r.end - r.start < best.end - best.start) best = r;
  }
  return best;
}

// The BINDINGS a typed line is about, each with the span it is visible in.
// An annotation attaches to a binding, not to a row of text, so
// `count: number = 42` on one line and `count = "nope"` on the next are one
// fact and must be gated as one — a purely lexical gate silences the
// violation of the annotation directly above it, which breaks this design's
// own promise.
//
// A binding is a NAME PAIRED WITH A SCOPE, not a name alone. `data: string`
// in one function and an unrelated `data = 5` in the next are two bindings
// that happen to share a spelling; gating them together checks a declaration
// nobody annotated, in a function nobody touched. The scope is read from the
// declaration's own position, so the pairing costs one tree walk and no
// guesswork about which spelling declares what.
//
// The names come off the lines already known to carry type information
// rather than off the token stream: taking every identifier on a typed
// line covers all annotation spellings at once (a bare forward's
// `y: number` lexes as a TYPE token like the rest), and pulls in
// the useful neighbours: `def filterBy(query: string)` types both the
// parameter and the function, so call sites are checked too.
//
// IDENTIFIERS only. A PROPERTY token — a member name, an object key — is
// text, not a binding: `cache: Map<K, V> = Map.new()` says nothing about
// `new`, and seeding it would make every `Error.new …` in the file a typed
// read and type whatever it is assigned to.
//
// Residual: an unannotated INNER binding that shadows a typed outer one
// still reads as typed, because this pass places a binding by where its
// declaration sits and never asks whether an inner scope redeclares the
// name. That errs toward more checking, which is the safe direction.
function typedBindingsOf(tokens, source, typedLines, regions) {
  const bindings = new Map();          // name → array of spans; null entry = whole file
  if (!tokens) return bindings;
  const lineAt = lineIndexer(source);
  for (const t of tokens) {
    if (t.kind !== 'IDENTIFIER') continue;
    if (typeof t.start !== 'number' || typeof t.value !== 'string') continue;
    if (!typedLines.has(lineAt(t.start))) continue;
    const scope = scopeAt(regions, t.start);
    const spans = bindings.get(t.value);
    if (spans === null) continue;                       // already whole-file
    if (!scope) { bindings.set(t.value, null); continue; }
    if (spans) spans.push(scope); else bindings.set(t.value, [scope]);
  }
  return bindings;
}

// The ASSIGNMENTS a source performs, as `{ name, at, value }` — the name
// bound, the offset it is bound at, and the span of the expression bound to
// it. This is the channel type information travels along: `total = count +
// ratio` off two annotated numbers makes `total` a number as surely as
// writing `total: number` would.
//
// Every reactive form joins the plain one: `:=`, `~=` and `=!` differ in what
// the binding DOES, never in whether a type flows into it. A target that is
// not a plain identifier (`@field`, a destructure, an index) is skipped —
// there is no single name to carry, and skipping only withholds checking.
//
// Every FUNCTION BODY inside the value is a HOLE in it — the same
// subtraction declarationHeadersOf makes for headers. A function's type is
// its signature, and a body that reads a typed binding is a fact about one
// local inside it: it types neither the name the function lands in nor the
// rest of the body. Subtraction is by CONTAINMENT, never by the value being
// a bare literal: `f = (x) -> …`, `f = ((x) -> …)`, `f = memo((x) -> …)`,
// and the method in `handlers = run: (x) -> …` all lose their bodies and
// keep their headers. Without it a 1,000-line `main = -> …` is typed whole
// because one line of it calls a typed helper — outward from a body, the
// direction the gate promises never to reach. What remains of the value —
// the header, the call, the object's keys — is what the value reads:
// `r = typedFn(x)` still types `r`. An annotation left standing in that
// remainder is type information too (scopeGateOf reads it), so
// `f = (x: T) -> …` and `api = fetch: (): number -> 42` type their names.
//
// Residual: a header's parameter names are identifiers, so a body-local
// annotation that mentions a parameter seeds it into the function's scope
// and the header reads it — more checking, the safe direction.
export function assignmentFlowsOf(stores, source) {
  const flows = [];
  if (!stores?.nodes) return flows;
  const KINDS = new Set(['assign', 'state', 'computed', 'readonly', 'typedvar']);
  const bodies = functionBodiesOf(stores);
  for (const n of stores.nodes) {
    if (!KINDS.has(n.semanticKind)) continue;
    const target = stores.role(n.nodeId, 'target');
    const value = stores.role(n.nodeId, 'value');
    if (typeof target?.sourceStart !== 'number' || typeof value?.sourceStart !== 'number') continue;
    const name = source.slice(target.sourceStart, target.sourceEnd);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
    const holes = bodies
      .filter((b) => b.bodyStart >= value.sourceStart && b.bodyEnd <= value.sourceEnd)
      .map((b) => [b.bodyStart, b.bodyEnd]);
    flows.push({ name, at: target.sourceStart, value: [value.sourceStart, value.sourceEnd], holes });
  }
  return flows;
}

// Reads and mentions are IDENTIFIER tokens alone, the mirror of seeding: a
// PROPERTY token spells a member name or an object key, and a name is not a
// reference. `styles = { position: 'fixed' }` reads no binding called
// `position`, whatever annotated function of that name the file declares.
//
// The file's identifier tokens, ordered by offset — the tape itself is not
// promised to be (a synthesized identifier can follow a token it precedes
// in the text), and the span lookup below is a binary search over this.
function identifierIndexOf(tokens) {
  const out = [];
  for (const t of tokens ?? []) if (t.kind === 'IDENTIFIER' && typeof t.start === 'number') out.push(t);
  return out.sort((a, b) => a.start - b.start);
}

// The identifier tokens a value span reads — the span's tokens minus its
// holes — collected ONCE per flow. The fixpoint asks the same question of
// the same span every round while only the bindings change, so the reads
// are indexed up front and each round tests those few tokens alone.
function readerTokensOf(identifiers, [start, end], holes = []) {
  const out = [];
  let lo = 0, hi = identifiers.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (identifiers[mid].start < start) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < identifiers.length; i++) {
    const t = identifiers[i];
    if (t.start >= end) break;
    if (holes.some(([s, e]) => t.start >= s && t.start < e)) continue;
    out.push(t);
  }
  return out;
}

// True when one of the reader tokens names a binding typed where it sits.
function readsTyped(readers, bindings) {
  for (const t of readers) {
    if (!bindings.has(t.value)) continue;
    const spans = bindings.get(t.value);
    if (!spans || spans.some((s) => t.start >= s.start && t.start < s.end)) return true;
  }
  return false;
}

// Lines mentioning a typed binding, which the lexical pass cannot reach: a
// use site is a sibling of its declaration, not a child of it. An occurrence
// counts only where the binding it names is visible.
function linesMentioning(tokens, source, bindings) {
  const lines = new Set();
  if (!tokens || bindings.size === 0) return lines;
  const lineAt = lineIndexer(source);
  for (const t of tokens) {
    if (t.kind !== 'IDENTIFIER') continue;
    if (typeof t.start !== 'number' || !bindings.has(t.value)) continue;
    const spans = bindings.get(t.value);
    if (spans && !spans.some(s => t.start >= s.start && t.start < s.end)) continue;
    lines.add(lineAt(t.start));
  }
  return lines;
}

// The names a module EXPORTS, each with the offset it is declared at.
// Declaration exports (`export answer: number = 42`, `export def go(…)`,
// `export class K`) report the declared name; a plain list (`export { x, y }`,
// with or without `as`) reports each name it lists.
export function exportedNamesOf(stores, source) {
  const names = [];
  if (!stores?.nodes) return names;
  // Every declaring form an export can wrap, the reactive ones included —
  // `export count: number := 0` binds `count` exactly as `=` would, and
  // leaving `state`/`computed`/`readonly` out silently dropped annotated
  // reactive exports from every importer's gate.
  const DECLS = new Set(['assign', 'state', 'computed', 'readonly', 'def', 'class', 'component', 'typedvar']);
  for (const node of stores.nodesByKind('export')) {
    const spec = stores.role(node.nodeId, 'spec');
    if (typeof spec?.sourceStart !== 'number') continue;
    // A declaration export: the declaration begins where the spec does.
    const decl = stores.nodes.find((n) => DECLS.has(n.semanticKind) && n.sourceStart === spec.sourceStart);
    const named = decl && (stores.role(decl.nodeId, 'name') ?? stores.role(decl.nodeId, 'target'));
    if (typeof named?.sourceStart === 'number') {
      names.push({ name: source.slice(named.sourceStart, named.sourceEnd), at: named.sourceStart });
      continue;
    }
    // Otherwise a list. `export default …` binds no name here and drops out
    // on the identifier test.
    for (const part of source.slice(spec.sourceStart, spec.sourceEnd).split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.push({ name, at: spec.sourceStart });
    }
  }
  return names;
}

// The bindings an IMPORT introduces: the local name, and the name it is
// bound to in the exporting module.
//
// A namespace import (`* as ns`) is skipped — its uses are member accesses
// through `ns`, not occurrences of a bare local, so there is no name for the
// gate to match. Skipping withholds checking, never grants it.
// One reader for the import NODES themselves — the module specifier
// (quotes stripped) and the clause text — consumed by both binding readers
// below. Their RESULTS stay apart on purpose (a namespace alias is not a
// binding of a typed export), but the iteration is one rule: how the
// compiler stores an import's source role is a fact with one spelling.
function* importNodesOf(stores, source) {
  if (!stores?.nodes) return;
  for (const node of stores.nodesByKind('import')) {
    const src = stores.role(node.nodeId, 'source');
    if (typeof src?.sourceStart !== 'number') continue;
    yield {
      module: source.slice(src.sourceStart, src.sourceEnd).replace(/^['"`]|['"`]$/g, ''),
      text: source.slice(node.sourceStart, node.sourceEnd),
    };
  }
}

export function importBindingsOf(stores, source) {
  const out = [];
  for (const { module, text } of importNodesOf(stores, source)) {
    const braced = /\{([^}]*)\}/.exec(text);
    for (const part of (braced?.[1] ?? '').split(',')) {
      const [imported, local] = part.trim().split(/\s+as\s+/).map((s) => s.trim());
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(imported ?? '')) continue;
      out.push({ local: local || imported, imported, module });
    }
    // The default binding: the bare name between `import` and the first
    // comma or `from`, with any braced list removed first.
    const head = text.replace(/\{[^}]*\}/, '').replace(/^import\s+/, '');
    const def = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|from\b)/.exec(head);
    if (def) out.push({ local: def[1], imported: 'default', module });
  }
  return out;
}

// The NAMESPACE imports a file makes: `import * as ns from '…'`.
//
// Kept apart from `importBindingsOf` rather than folded into it, because
// that function's result is what `scopeGateOf` reads as `typedImports`, and
// a namespace alias is not a binding of a typed export — it is a binding of
// the whole module. Callers that want it ask for it.
//
// Anchored on the STAR, not on the start of the clause: a default binding
// may precede it (`import def, * as ns`) and the space after it is optional
// (`import *as ns`). Both compile to a real namespace import, so both bind
// the module here.
export function namespaceImportsOf(stores, source) {
  const out = [];
  for (const { module, text } of importNodesOf(stores, source)) {
    const ns = /\*\s*as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\b/.exec(text);
    if (ns) out.push({ local: ns[1], module });
  }
  return out;
}

// The LOCAL names an import bound to a typed export — what a caller hands
// `scopeGateOf` as `typedImports`.
//
// One definition, three callers (the CLI, the editor's disk face, the
// editor's per-keystroke face). They differ only in where a module's typed
// exports come from, which is `typedExportsAt`; letting each resolve imports
// its own way is how the editor and `rip check` drift apart.
//
// Three kinds of specifier carry type information:
//
//   Relative `.rip` — the modules whose faces this toolchain builds and can
//   therefore ask, matching `ripImportsOf`. Only the ANNOTATED exports
//   count, which is `typedExportsAt`'s question.
//
//   Relative `.ts`/`.tsx`/`.mts`/`.cts` (and `.d.ts` through the first) —
//   TypeScript source IS the annotation language, so every export is typed
//   by construction and there is nothing to ask. A `.js` sibling is the
//   opposite and stays untyped; an extensionless specifier is not resolved
//   (withholding checking, the safe direction).
//
//   Bare, landing on a workspace `.rip` (`@rip/util`, resolved the way the
//   runtime resolves it — ripSpecifierTarget) — the same module as a
//   relative `.rip` spelled through its package name, asked the same
//   question. Any other bare specifier is some other ecosystem's module
//   and carries nothing here.
export function typedImportsOf(stores, source, fromDir, typedExportsAt) {
  const local = new Set();
  if (!stores) return local;
  for (const b of importBindingsOf(stores, source)) {
    if ((b.module.startsWith('./') || b.module.startsWith('../'))
      && /\.(ts|tsx|mts|cts)$/.test(b.module)) { local.add(b.local); continue; }
    const target = ripSpecifierTarget(b.module, fromDir);
    if (target === null) continue;
    let exports;
    try { exports = typedExportsAt(target); } catch { continue; }
    if (exports?.has(b.imported)) local.add(b.local);
  }
  return local;
}

// The exports a module supplies TYPE INFORMATION for — what an importer
// needs to gate its own uses, and the one fact it cannot compute for itself.
//
// FILE-LOCAL by construction: it asks only what this source says about its
// own declarations, never what its dependencies say. That is what keeps a
// cycle (`a.rip` ↔ `b.rip`) from recurring through the gate.
export function typedExportsOf(tokens, source, face) {
  const names = new Set();
  const typed = typedLinesOf(tokens, source, face);
  const bindings = typedBindingsOf(tokens, source, typed, scopeRegionsOf(face?.stores));
  const lineAt = lineIndexer(source);
  for (const { name, at } of exportedNamesOf(face?.stores, source)) {
    if (typed.has(lineAt(at))) { names.add(name); continue; }
    const spans = bindings.get(name);
    if (spans === null || (spans && spans.some((s) => at >= s.start && at < s.end))) names.add(name);
  }
  return names;
}

// The lines this source itself carries type information on: what the author
// annotated, what the compiler added, and what an annotation in a
// declaration's header says about the declaration it heads.
function typedLinesOf(tokens, source, face) {
  const typed = annotatedLinesOf(tokens, source);
  const lineAt = lineIndexer(source);
  // OUTWARD: an annotation in a declaration's header is an annotation on the
  // declaration, so it lands on the line that NAMES it. Only the author's own
  // TYPE tokens count here — a directive is a claim about one line and a
  // tsRegion is scaffolding, and neither says the declaration is typed. A
  // schema or component needs no token at all: the face types it by
  // construction (COMPILER_TYPED_KINDS).
  const offsets = [];
  for (const t of tokens ?? []) if (t.kind === 'TYPE' && typeof t.start === 'number') offsets.push(t.start);
  for (const decl of declarationHeadersOf(face?.stores)) {
    if (COMPILER_TYPED_KINDS.has(decl.kind) || offsets.some((o) => inHeader(decl, o))) typed.add(lineAt(decl.name.sourceStart));
  }
  return typed;
}

// The whole computation, for a caller holding the lexer and the face.
//
// Three passes widen one set of typed lines, and the lexical scope pass runs
// LAST over the union — so whatever a pass switches on brings its body with
// it, and a declaration reached through its name checks the same way one
// reached through its own annotation does.
export function scopeGateOf(tokens, source, face, typedImports = null) {
  const annotated = typedLinesOf(tokens, source, face);
  // ACROSS: an import of an ANNOTATED export carries that export's type
  // information into this file. `typedImports` is the set of local names the
  // caller resolved to one; resolution is the caller's because it needs the
  // filesystem and this module stays pure.
  //
  // Without this the boundary is incoherent: move an annotated function from
  // one file to another and checking switches on, move it back and it
  // switches off, on a program whose annotations never changed. An import of
  // an UNannotated export is not covered — nobody wrote a type in either
  // file, so there is nothing to carry.
  // FLOW: type information moves along assignment, so a binding initialized
  // from typed bindings is typed too — and to a fixpoint, because stopping
  // after one hop would gate the violation on the next line, the same
  // born-here-dies-there failure that sank filtering by diagnostic code.
  //
  // Flow follows ASSIGNMENT and never mere adjacency. Seeding takes every
  // identifier on a typed line, which is right for a declaration and fatal
  // if iterated: `console` sits on typed lines everywhere, and one more
  // round would make every `console.log` in the file typed and the gate
  // vacuous. An assignment names exactly what receives the type.
  //
  // Monotone and bounded — each round adds at least one binding or stops.
  const regions = scopeRegionsOf(face?.stores);
  const bindings = typedBindingsOf(tokens, source, annotated, regions);
  // An imported binding is visible file-wide: an import declares at module
  // scope, and no inner scope it might be shadowed in was reached by the
  // annotation that typed it.
  for (const local of typedImports ?? []) bindings.set(local, null);
  const flows = assignmentFlowsOf(face?.stores, source);
  // An annotation standing in a value, outside every subtracted body, is
  // type information the author wrote INTO the value: `api = fetch: ():
  // number -> 42` types `api`, and the method's callers are reached through
  // the object that carries it.
  const typeOffsets = [];
  for (const t of tokens ?? []) if (t.kind === 'TYPE' && typeof t.start === 'number') typeOffsets.push(t.start);
  const annotatedWithin = (flow) => typeOffsets.some((o) =>
    o >= flow.value[0] && o < flow.value[1] && !flow.holes.some(([s, e]) => o >= s && o < e));
  const identifiers = identifierIndexOf(tokens);
  for (const flow of flows) { flow.pending = true; flow.readers = readerTokensOf(identifiers, flow.value, flow.holes); }
  for (;;) {
    let grew = false;
    for (const flow of flows) {
      if (!flow.pending) continue;
      if (!annotatedWithin(flow) && !readsTyped(flow.readers, bindings)) continue;
      flow.pending = false;
      grew = true;
      const scope = scopeAt(regions, flow.at);
      const spans = bindings.get(flow.name);
      if (spans === null) continue;
      if (!scope) bindings.set(flow.name, null);
      else if (spans) spans.push(scope);
      else bindings.set(flow.name, [scope]);
    }
    if (!grew) break;
  }
  // SIDEWAYS: a line is typed if it uses one of those bindings, anywhere the
  // binding is visible. A use site is a SIBLING of its declaration, which is
  // the one direction indentation cannot reach.
  for (const line of linesMentioning(tokens, source, bindings)) annotated.add(line);
  // INWARD: indentation, last, over everything the passes above found.
  return checkedLinesOf(source, annotated);
}
