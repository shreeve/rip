// Types — the compile-time type surface, which is an ERASURE. Rip
// types are annotations the grammar never parses: this pass finds each
// one, collapses its token run into a single opaque TYPE or CAST token,
// and that token carries text the emitter drops on the floor. Nothing
// here survives into JavaScript.
//
// That is the whole symmetry with schema.js. Both files are a rewrite
// pass plus the compile-time surface of one construct, and both sit
// beside the renderer that turns their result into TypeScript text
// (ts/types.js here, ts/schema.js there). The difference is what
// the construct becomes: a schema becomes CODE, so schema.js carries a
// serializer; a type becomes NOTHING, so this file does not.
//
// `tokenize` imports two things from here, and the split is worth
// naming. `rewriteTypes` is the pass — it runs as a tail pass, after
// the scan. The four predicates below it (typeAliasEq,
// atStatementBoundary, beforeAngleGroupBack, closesTypeGeneric) run
// DURING the scan, because deciding whether a line continues means
// asking whether a trailing `<` opened a type generic or compared two
// values. The scanner cannot answer that; type shape can. The import
// is one-directional — nothing here reaches back into lexer.js.

import { counter } from './counter.js';

// ── Type-annotation collapse pass ───────────────────────────────────
// Rip types are erased annotations: a single-colon
// annotation in a TYPE POSITION (function params, return types,
// statement-level typed declarations) and the postfix `expr as Type`
// cast. The grammar never parses a type — this pass collapses each
// annotation's token run into ONE token carrying the opaque type
// string as its value and the annotation's full source extent as its
// span:
//   TYPE — `: run` (span from the colon through the type's end)
//   CAST — `as run` (span from `as` through the type's end)
// Runs before implicitBlocks/implicitObjects/implicitCalls:
// a claimed colon can no longer open an implicit object, and a
// claimed `as` can no longer become an implicit call's callee/argument.
// Colons NOT in a type position — object pairs, ternary branches,
// pattern renames — are deliberately untouched.
//
// This is the pipeline's one COLLAPSE pass: it removes each claimed
// run from the tape and mints a fresh token in its place (ids stay
// stable for every surviving token; indices are never stored).

// Tokens that can END the left-hand expression of an `expr as Type`
// cast. CAST is included so chains (`x as A as B`) collapse one cast
// at a time.
const CAST_LHS_ENDERS = new Set([
  'IDENTIFIER', 'PROPERTY', 'NUMBER', 'STRING', 'STRING_END', 'REGEX',
  'HEREGEX_END', 'BOOL', 'NULL', 'UNDEFINED', ')', 'CALL_END', 'PARAM_END',
  ']', 'INDEX_END', '}', 'PICK_END', 'THIS', '@', 'SUPER', '?', 'PRESENCE',
  'DAMMIT', 'CAST', 'IMPORT_META',
]);

// Tokens that can BEGIN a type expression. RESERVED covers the TS
// types that spell JS reserved words (`void`, `unknown` is an
// identifier, `typeof` arrives as UNARY). PROPERTY covers a type name
// the scanner key-tagged because a ':' follows — the ternary
// else-branch colon of `a ? x as T : b` (the cast run stops at the
// ':', which stays the ternary's).
const TYPE_STARTERS = new Set([
  'IDENTIFIER', 'PROPERTY', '(', 'CALL_START', 'PARAM_START', '{', '[',
  'INDEX_START', 'STRING', 'NUMBER', 'BOOL', 'NULL', 'UNDEFINED', '-',
  'UNARY', 'NEW', 'RESERVED',
]);

const RUN_OPENERS = new Set(['(', 'CALL_START', 'PARAM_START', '[', 'INDEX_START', '{', 'PICK_START', 'OPTPICK_START']);
export const RUN_CLOSERS = new Set([')', 'CALL_END', 'PARAM_END', ']', 'INDEX_END', '}', 'PICK_END']);

// Depth-0 enders of every type run. `=` ends a typed declaration's or
// typed default param's annotation — the reactive assign heads (`:=`,
// `~=`), the readonly head (`=!`), and the effect head (`~>`) end one
// the same way (`count: number := 0`, `x: number =! 5`,
// `h: Function ~> body`); `->` is the arrow
// operator (a function TYPE spells `=>`, which stops only in
// arrow-return position).
export const RUN_STOPS = new Set(['TERMINATOR', 'INDENT', 'OUTDENT', ',', '=', 'COMPOUND_ASSIGN', 'REACTIVE_ASSIGN', 'COMPUTED_ASSIGN', 'READONLY_ASSIGN', 'GATE', 'EFFECT', '->']);

// Extra depth-0 stops for the cast's type run: the postfix cast lives
// inside a larger expression, so any binary/relational/ternary operator
// ends it (`|` and `&` are NOT stops — they are the union/intersection
// type operators, so `x as A | B` reads `x as (A | B)`, as in TS) —
// and so does any statement-clause keyword: a trailing clause never
// swallows into the type string, so `y = x as T if c` keeps its
// guard. Depth-0 range dots are code operators too, both spellings
// (`[a as T..b]`, `[a as T...b]`); a tuple's `...` rest sits at
// bracket depth, untouched. Gated against the grammar by
// test/toolchain/cast-stops.test.js: every terminal the parser can
// accept after an Expression must stop the run or be a named
// continuation there.
export const CAST_STOPS = new Set([
  '+', '-', 'MATH', '**', 'SHIFT', 'COMPARE', 'MATCH', '&&', '||', '??',
  '^', 'RELATION', 'TERNARY', '?', 'PRESENCE', ':', '?.', 'DAMMIT',
  'EXTENDS', '..', '...',
  'IF', 'UNLESS', 'ELSE', 'THEN', 'WHILE', 'UNTIL', 'LOOP', 'FOR',
  'WHEN', 'BY', 'SWITCH', 'RETURN', 'THROW', 'CATCH', 'FINALLY',
]);

// Statement-clause keywords that end a TYPE ALIAS's right-hand run at
// depth 0. A conditional type's own tokens (`extends`, `?`, `:`) stay
// collectable — only clause keywords stop the run, and a run that
// stops before its line ends fails the alias claim LOUDLY.
const ALIAS_STOPS = new Set([
  'IF', 'UNLESS', 'ELSE', 'THEN', 'WHILE', 'UNTIL', 'LOOP', 'FOR',
  'WHEN', 'BY', 'SWITCH', 'RETURN', 'THROW',
]);

// The TYPE-TOKEN VOCABULARY: everything a `type`/`interface` BODY may
// contain (one-line alias right-hand sides, block alias bodies,
// interface members). Names and qualified names, literal types,
// generics, unions/intersections, function-type arrows, grouping
// parens, tuple/structural brackets and braces, conditional-type
// tokens, `typeof`, and block layout. `this` is TYPE vocabulary
// (RULED 2026-08-03): TypeScript's polymorphic `this` type —
// `chain(): this`, `isFoo(): this is Foo` — is a type atom like any
// name; where a position disallows it, the checker says so. Code-shaped
// tokens — calls (CALL_START), `new`, `await`, arithmetic/logical
// operators, assignments inside bodies — are NOT in the vocabulary and
// reject loudly (`this.foo()` still rejects: the CALL is the code
// shape, not the word).
const TYPE_VOCAB = new Set([
  'IDENTIFIER', 'PROPERTY', 'RESERVED', 'NUMBER', 'STRING', 'BOOL',
  'NULL', 'UNDEFINED', 'THIS',
  '.', ',', ':', '?', 'TERNARY', '...', '|', '&', '=>', 'EXTENDS',
  '(', ')', 'PARAM_START', 'PARAM_END', '[', ']', 'INDEX_START',
  'INDEX_END', '{', '}',
  'INDENT', 'OUTDENT', 'TERMINATOR',
]);

// Reject the first code-shaped token in a type body [from, to).
// Allowed beyond TYPE_VOCAB, by shape: `<`/`>` generic angles (other
// COMPARE spellings are comparisons), `>>`/`>>>` generic closes,
// `typeof` (the one type-operator UNARY), `-` directly before a
// NUMBER in PREFIX position (a negative literal type — after an atom
// the `-` is arithmetic, and `type X = 5 - 3` is no literal type),
// and `=` only inside generic angles (a parameter default,
// `Foo<T = U>`). Angle brackets must BALANCE across the body: a
// vocabulary-shaped `a >` line is not a type, and an unclosed `<`
// cannot end one. With `opts.methods` (interface bodies), METHOD
// SHORTHAND members (`m(x: number): void`) are legal: the unspaced
// `(` after a member name scans CALL_START — accepted only when the
// name starts a member line and a return annotation follows the
// close; the parameter list's interior stays under this same
// vocabulary (a nested call still rejects).
const TYPE_ATOM_ENDERS = new Set([
  'IDENTIFIER', 'PROPERTY', 'RESERVED', 'NUMBER', 'STRING', 'BOOL',
  'NULL', 'UNDEFINED', 'THIS', ')', 'PARAM_END', ']', 'INDEX_END', '}',
]);
// Does tokens[at] begin a MEMBER ROW of a type body? True at a layout
// boundary (a block body's rows), after `{` or a comma (an inline
// literal's), and after a member modifier. Shared by the two member
// shapes the floor admits: a method shorthand's name, and a mapped
// type's `[`. The CALLER supplies the enclosing group, because a comma
// separates members only inside braces — inside `<…>` or `[…]` it
// separates type arguments and tuple elements, and reading one as a
// member row misreports a genuine call there.
const MEMBER_ROW_OPENERS = new Set(['TERMINATOR', 'INDENT', 'OUTDENT', '{', ',']);
const memberRowStart = (tokens, at, from) => {
  if (at - 1 < from) return true;
  const before = tokens[at - 1];
  // A member modifier is transparent — the row starts at the modifier,
  // so keep walking left. `readonly` has to be walked through rather
  // than merely accepted: it also prefixes a TUPLE type, and
  // `{ x: readonly [name in host] }` is a member whose VALUE happens
  // to begin with it, not a mapped-type row.
  if (before.value === 'readonly' ||
      ((before.kind === '-' || before.kind === '+') && tokens[at].value === 'readonly')) {
    return memberRowStart(tokens, at - 1, from);
  }
  return MEMBER_ROW_OPENERS.has(before.kind);
};

// Bracket kinds by the group they open, innermost-last. Only kinds the
// vocabulary itself carries: a CALL_START/CALL_END pair reaches the floor
// solely through the method-shorthand branch, which pushes and pops its
// own group, so listing them here would double-count that pair.
const GROUP_OPENERS = new Map([
  ['{', '{'], ['[', '['], ['INDEX_START', '['],
  ['(', '('], ['PARAM_START', '('],
]);
const GROUP_CLOSERS = new Set(['}', ']', 'INDEX_END', ')', 'PARAM_END']);

const assertTypeVocabulary = (tokens, from, to, fail, opts = {}) => {
  let angle = 0;
  // The open groups, innermost last. `enclosing()` is the group a
  // token sits directly inside — what tells a member separator from a
  // type-argument or tuple separator.
  const groups = [];
  const enclosing = (up = 0) => groups[groups.length - 1 - up];
  let openAngle = null; // outermost unmatched '<'
  let atomEnd = false;  // the previous token completed a type atom
  // Indices of the CALL_ENDs closing accepted method lists, innermost
  // last. A STACK, not a scalar: a parameter's own object type can carry
  // a member row of its own, and TypeScript nests these freely.
  const methodCloses = [];
  const closeAngles = (t, n) => {
    angle -= n;
    for (let k = 0; k < n; k++) groups.pop();
    if (angle < 0) {
      fail(`unbalanced '${t.value}' in a type body — the line is not a type`, t.start);
    }
    if (angle === 0) openAngle = null;
  };
  for (let j = from; j < to; j++) {
    if (counter.on) counter.n++;
    const t = tokens[j];
    const kd = t.kind;
    if (kd === 'COMPARE' && t.value === '<') {
      if (angle === 0) openAngle = t;
      angle++;
      groups.push('<');
      atomEnd = false;
      continue;
    }
    if (kd === 'COMPARE' && t.value === '>') { closeAngles(t, 1); atomEnd = true; continue; }
    if (kd === 'SHIFT' && t.value === '>>') { closeAngles(t, 2); atomEnd = true; continue; }
    if (kd === 'SHIFT' && t.value === '>>>') { closeAngles(t, 3); atomEnd = true; continue; }
    if (kd === 'UNARY' && t.value === 'typeof') { atomEnd = false; continue; }
    // A type predicate: `(v: unknown) => v is string`, and the `asserts`
    // spelling beside it. The token arrived rewritten (`is` aliases to
    // COMPARE '=='); in type text it is TypeScript's predicate operator,
    // and it reads as the word the user wrote. Admitted by the whole
    // shape — the parameter name (or `this`, TS's other predicate
    // subject) between the arrow (or `asserts`, or a method shorthand's
    // return `:`) and `is` — because return position
    // is the only place TS puts one, and `atomEnd` alone would admit
    // `string is number` anywhere a type completed. The shorthand's `:`
    // identifies itself by the CALL_END before it: no other colon in a
    // type body follows a parameter list's close.
    if (t.word === 'is' && atomEnd && j - 2 >= from &&
        (tokens[j - 1].kind === 'IDENTIFIER' || tokens[j - 1].kind === 'PROPERTY' ||
         tokens[j - 1].kind === 'THIS') &&
        (tokens[j - 2].kind === '=>' || tokens[j - 2].value === 'asserts' ||
        (tokens[j - 2].kind === ':'  && tokens[j - 3]?.kind === 'CALL_END'))) {
      atomEnd = false; continue;
    }
    // A mapped type's `in`: `{ [K in keyof T]: T[K] }`. Admitted by
    // the whole shape — a `[` OPENING A MEMBER ROW inside braces, then
    // the parameter name, then `in`. The bracket alone does not
    // identify it: `[name in host]` (a tuple) and `Host[name in host]`
    // (an indexed access) put the same three tokens in a row and are
    // membership expressions no TS grammar allows there, so what
    // separates a mapped type is where its `[` sits.
    if (kd === 'RELATION' && t.value === 'in' &&
        enclosing() === '[' && enclosing(1) === '{' && j - 2 >= from &&
        (tokens[j - 2].kind === '[' || tokens[j - 2].kind === 'INDEX_START') &&
        (tokens[j - 1].kind === 'IDENTIFIER' || tokens[j - 1].kind === 'PROPERTY') &&
        memberRowStart(tokens, j - 2, from)) {
      atomEnd = false; continue;
    }
    // Optional-member marker: `name?: T` — the `?`
    // rides between a completed atom (the member name) and its `:`,
    // whatever kind the scanner gave it (PRESENCE/TERNARY). The same
    // shape covers optional params inside method shorthand
    // (`m(x?: number): void`). Any other `?` stays code-shaped.
    if (t.value === '?' && atomEnd && tokens[j + 1]?.kind === ':') { atomEnd = false; continue; }
    if (kd === '-' && tokens[j + 1]?.kind === 'NUMBER' && !atomEnd) { j++; atomEnd = true; continue; }
    // A mapped type's modifier prefix: `{ -readonly [K in keyof T]: … }`.
    // Only directly inside braces at a member row AND directly before
    // the mapped row's `[` — the one position TS allows the modifier.
    // Without the bracket check, `{ -readonly x: T }` (no mapped row,
    // not TS) would slip through as a type.
    if ((kd === '-' || kd === '+') && tokens[j + 1]?.value === 'readonly' &&
        (tokens[j + 2]?.kind === '[' || tokens[j + 2]?.kind === 'INDEX_START') &&
        enclosing() === '{' && memberRowStart(tokens, j, from)) {
      atomEnd = false; continue;
    }
    // The optionality half: `[K in keyof T]-?: T[K]` / `+?` — the
    // modifier rides AFTER the mapped row's `]`, directly before the
    // member's `?:`. Completing the atom here lets the ordinary
    // optional-member rule admit the `?` that follows.
    if ((kd === '-' || kd === '+') && tokens[j + 1]?.value === '?' &&
        tokens[j + 2]?.kind === ':' && enclosing() === '{' &&
        (tokens[j - 1]?.kind === ']' || tokens[j - 1]?.kind === 'INDEX_END')) {
      atomEnd = true; continue;
    }
    if (kd === '=' && angle > 0) { atomEnd = false; continue; }
    if ((enclosing() === '{' || (opts.methods && enclosing() === undefined)) &&
        kd === 'CALL_START') {
      const name = tokens[j - 1];
      // The shorthand is the same member in either layout — block
      // rows and an inline literal's — so both admit it. The inline
      // call signature `{ (v: number): string }` already compiles,
      // which is what makes the named member's rejection the check's
      // reach rather than the sub-language's scope.
      const memberStart = memberRowStart(tokens, j - 1, from);
      if (name && (name.kind === 'IDENTIFIER' || name.kind === 'PROPERTY') && memberStart) {
        let d = 1;
        let k = j + 1;
        while (k < to && d > 0) {
          if (tokens[k].kind === 'CALL_START') d++;
          else if (tokens[k].kind === 'CALL_END') d--;
          k++;
        }
        if (d === 0 && tokens[k]?.kind === ':') {
          methodCloses.push(k - 1);
          groups.push('(');
          atomEnd = false;
          continue;
        }
        if (d === 0) {
          fail(
            `an interface method shorthand needs a return type — \`${name.value}(…): T\``,
            name.start,
          );
        }
      }
    }
    if (kd === 'CALL_END' && j === methodCloses[methodCloses.length - 1]) {
      methodCloses.pop(); groups.pop(); atomEnd = true; continue;
    }
    if (TYPE_VOCAB.has(kd)) {
      if (GROUP_OPENERS.has(kd)) groups.push(GROUP_OPENERS.get(kd));
      else if (GROUP_CLOSERS.has(kd)) groups.pop();
      atomEnd = TYPE_ATOM_ENDERS.has(kd);
      continue;
    }
    // Aliased tokens (`is`, `and`, `or`, …) arrive rewritten to their
    // operator value; the rejection quotes the word the user typed.
    fail(
      `code expression ('${t.word ?? t.value}') in a type body — types erase and cannot execute`,
      t.start,
    );
  }
  if (angle > 0) {
    fail("unclosed '<' in a type body — the generic never closes", openAngle.start);
  }
};

// Indents whose OPENER expects a value are object-body/argument
// positions, not statement blocks: a `name: T = v` line there is an
// object member, never a typed declaration.
const VALUE_INDENT_OPENERS = new Set([
  '=', ':', 'COMPOUND_ASSIGN', 'REACTIVE_ASSIGN', 'COMPUTED_ASSIGN',
  'READONLY_ASSIGN',
  ',', '[', '(', '{', 'CALL_START',
  'INDEX_START', 'PARAM_START', 'PICK_START', 'OPTPICK_START',
  'RETURN', 'THROW', 'AWAIT', 'YIELD',
]);

// Is the token at index k (the one directly before a candidate `name :`)
// a statement boundary? EXPORT counts (`export x: T = v` — the binding
// starts a statement). INDENT/OUTDENT boundaries additionally require
// the enclosing block to be a STATEMENT block (see VALUE_INDENT_OPENERS).
export const atStatementBoundary = (tokens, k) => {
  const t = tokens[k];
  if (!t) return true; // start of file
  if (t.kind === 'TERMINATOR' || t.kind === 'EXPORT') return true;
  if (t.kind !== 'INDENT' && t.kind !== 'OUTDENT') return false;
  // Walk back past balanced INDENT/OUTDENT pairs to the enclosing
  // block's INDENT and inspect its opener.
  let depth = 0;
  for (let j = k; j >= 0; j--) {
    if (counter.on) counter.n++;
    const kd = tokens[j].kind;
    if (kd === 'OUTDENT') depth++;
    else if (kd === 'INDENT') {
      if (depth === 0) {
        const before = tokens[j - 1];
        return !(before && VALUE_INDENT_OPENERS.has(before.kind));
      }
      depth--;
    }
  }
  return true; // file-top block
};

// Does the token slice [a, b) form a complete, well-formed TYPE
// expression (vs a value expression)? Decides whether a statement-level
// `name: (…) => R = value` colon is an annotation (the fn-type-valued
// declaration) — a whitelist of type tokens, bracket/generic balance,
// and an adjacency rule (two atoms with no separator is a value, which
// kills the comparison `x < y > z`).
const isCompleteTypeExpr = (tokens, a, b) => {
  if (b <= a) return false;
  const SEP = new Set(['|', '&', ',', ':', '?', 'TERNARY', '.', '...']);
  let par = 0, brk = 0, brc = 0, gen = 0, atomEnd = false;
  const parInfo = [];          // per-paren-depth: { colon, open }
  let lastClosedParen = null;  // { colon, empty } of the last closed group
  for (let j = a; j < b; j++) {
    if (counter.on) counter.n++;
    const t = tokens[j].kind, v = tokens[j].value;
    // A function-type arrow is valid only after a closed param group
    // that is empty `()` or typed `(x: T)`; an untyped `(e) =>` is a
    // value arrow.
    if (t === '=>') {
      const p = j > a ? tokens[j - 1].kind : null;
      if ((p === ')' || p === 'PARAM_END') && lastClosedParen &&
          (lastClosedParen.colon || lastClosedParen.empty)) { atomEnd = false; continue; }
      return false;
    }
    if (t === '(' || t === 'PARAM_START') { parInfo.push({ colon: false, open: j }); par++; atomEnd = false; continue; }
    if (t === ')' || t === 'PARAM_END') { if (--par < 0) return false; const pi = parInfo.pop(); lastClosedParen = pi ? { colon: pi.colon, empty: j === pi.open + 1 } : null; atomEnd = true; continue; }
    if (t === '[' || t === 'INDEX_START') { brk++; atomEnd = false; continue; }
    if (t === ']' || t === 'INDEX_END') { if (--brk < 0) return false; atomEnd = true; continue; }
    if (t === '{') { brc++; atomEnd = false; continue; }
    if (t === '}') { if (--brc < 0) return false; atomEnd = true; continue; }
    if (t === 'COMPARE') {
      if (v === '<') { gen++; atomEnd = false; continue; }
      if (v === '>') { if (gen <= 0) return false; gen--; atomEnd = true; continue; }
      return false; // ==, !=, <=, >= → not a type
    }
    if (t === 'SHIFT') {
      if (v === '>>') { if (gen < 2) return false; gen -= 2; atomEnd = true; continue; }
      if (v === '>>>') { if (gen < 3) return false; gen -= 3; atomEnd = true; continue; }
      return false;
    }
    if (t === '=') { if (gen > 0) { atomEnd = false; continue; } return false; } // generic default only
    if (SEP.has(t)) { if (t === ':' && parInfo.length) parInfo[parInfo.length - 1].colon = true; atomEnd = false; continue; }
    if (t === 'IDENTIFIER' || t === 'PROPERTY' || t === 'NUMBER' || t === 'RESERVED' ||
        t === 'STRING' || t === 'NULL' || t === 'UNDEFINED' || t === 'BOOL') {
      if (atomEnd) return false; // two atoms, no separator → not a type
      atomEnd = true; continue;
    }
    return false; // any non-type token → value
  }
  return par === 0 && brk === 0 && brc === 0 && gen === 0 && atomEnd;
};

// Collect a type-expression run starting at tokens[j]. Returns
// { parts, consumed, end } — parts are the value strings the type
// string is built from; empty parts means "no type here" and the
// caller must not claim. Depth counts every bracket kind plus generics
// (`<`/`>`); `>>`/`>>>` close two/three generic levels.
//
// THE BALANCE DISCIPLINE: a `<` claimed as a generic opener
// must meet its `>` inside the run. An unmatched `<` fails LOUDLY
// from its own position — without the check the run would swallow
// the rest of the expression into the type string (`x = a as T < b`
// would emit `x = a;`, the comparison vanishing silently). Balance is checked HERE and not through the type-body
// vocabulary floor (assertTypeVocabulary) because the two guards
// answer different questions: junk TEXT inside a claimed run stays
// opaque for the declaration artifact to diagnose (the `'T: U'`
// annotation precedent), but unbalance changes which TOKENS the run
// consumes — program structure, not type text — so it must fail at
// claim time.
const collectTypeRun = (tokens, j, opts, fail) => {
  const parts = [];
  const braceStack = []; // innermost open bracket kind: '{' '[' '(' '<'
  const angleOpens = []; // the open `<` tokens, innermost last
  let depth = 0;
  const startJ = j;
  let end = tokens[j - 1]?.end ?? 0;

  const unclosedAngle = (tok) => fail(
    "unclosed '<' in a type — the generic argument list never closes" +
    (opts.cast ? "; if the '<' was meant as a comparison, parenthesize the cast: '(x as T) < y'" : ''),
    tok.start,
  );
  // Close n generic levels; anything but an open `<` under the closer
  // is unbalanced.
  const closeAngles = (t, n) => {
    for (let k = 0; k < n; k++) {
      if (braceStack[braceStack.length - 1] !== '<') {
        fail(`unbalanced '${t.value}' in a type — no open '<' pairs with it`, t.start);
      }
      braceStack.pop();
      angleOpens.pop();
      depth--;
    }
  };

  outer: while (j < tokens.length) {
    if (counter.on) counter.n++;
    const t = tokens[j];
    const kd = t.kind;

    // A chained cast: the second `as` starts a new cast on the result.
    if (opts.cast && depth === 0 && kd === 'IDENTIFIER' && t.value === 'as') break;
    // The cast's type lives on one logical line: a depth-0 line break
    // that survived as a plain continuation (a trailing `>` suppresses
    // the TERMINATOR) must not let the run swallow the next line.
    if (opts.cast && depth === 0 && j > startJ && t.newLine) break;

    // With any `<` open, a shift spelling is a multi-level generic
    // close and must line up exactly — an over-close (`Map<K>> 2`)
    // fails at the SHIFT token, the actual offender, not at a `<`
    // that did meet a close. With no `<` open the spelling falls
    // through to the depth-0 rules (a cast stop; opaque text in
    // annotation runs).
    if (kd === 'SHIFT' && (t.value === '>>' || t.value === '>>>') && angleOpens.length > 0) {
      closeAngles(t, t.value === '>>' ? 2 : 3);
      parts.push(t.value); end = t.end; j++;
      continue;
    }

    if (kd === 'COMPARE' && t.value === '>') {
      if (depth === 0) break; // the enclosing construct's closer
      closeAngles(t, 1);
      parts.push(t.value); end = t.end; j++;
      continue;
    }
    const isOpen = RUN_OPENERS.has(kd) || (kd === 'COMPARE' && t.value === '<');
    if (isOpen) {
      depth++;
      const bk = kd === '{' ? '{' : (kd === '[' || kd === 'INDEX_START') ? '[' : (kd === 'COMPARE') ? '<' : '(';
      braceStack.push(bk);
      if (bk === '<') angleOpens.push(t);
      parts.push(t.value); end = t.end; j++;
      continue;
    }
    if (RUN_CLOSERS.has(kd)) {
      if (depth === 0) break; // the enclosing construct's closer
      // A bracket closer arriving over an open `<` means the generic
      // never closed — the closer belongs to the construct around it.
      if (braceStack[braceStack.length - 1] === '<') {
        unclosedAngle(angleOpens[angleOpens.length - 1]);
      }
      depth--;
      braceStack.pop();
      parts.push(t.value); end = t.end; j++;
      continue;
    }
    // Literal-context closers (interpolation/string/heregex ends) can
    // never belong to a type — their openers cannot appear inside a
    // run — so they end it unconditionally (`"#{n as T}"`).
    if (kd === 'INTERPOLATION_END' || kd === 'STRING_END' || kd === 'HEREGEX_END') break;

    if (depth === 0) {
      if (RUN_STOPS.has(kd)) break;
      if (opts.stopAtFatArrow && kd === '=>') break;
      if (opts.cast && CAST_STOPS.has(kd)) {
        // A cast's numeric literal type may open SIGNED: `x as -1`
        // claims (TypeScript's negative numeric literal type). `+` is
        // not TS type syntax there and rejects with the fix; past the
        // opening position a sign is the arithmetic operator and ends
        // the run (`x as T - 1`).
        if (j === startJ && (kd === '-' || kd === '+') && tokens[j + 1]?.kind === 'NUMBER') {
          if (kd === '+') {
            fail("a numeric literal type spells its sign with '-' (TypeScript has no '+1' type)", t.start, tokens[j + 1].end);
          }
        } else break;
      }
      if (opts.alias && ALIAS_STOPS.has(kd)) break;
    } else {
      // Inside brackets, INDENT/OUTDENT are pure layout; TERMINATOR
      // separates structural-type fields (emitted as ';' so the type
      // string is valid TS).
      if (kd === 'INDENT' || kd === 'OUTDENT') { j++; continue; }
      if (kd === 'TERMINATOR') { parts.push(';'); end = t.end; j++; continue; }
      // A `>`-ending field suppresses its TERMINATOR (the scanner's
      // unfinished-line rule); a new PROPERTY at the top of a `{`
      // marks the seam — inject the separator.
      if (kd === 'PROPERTY' && braceStack[braceStack.length - 1] === '{') {
        const prev = parts[parts.length - 1];
        if (prev && prev !== '{' && prev !== ',' && prev !== ';') parts.push(';');
      }
    }

    // Optional-member marker: an unspaced `?` directly before `:` glues
    // to its name (`b?: string`), inside structural types and beyond.
    if (kd === '?' && !t.spaced && tokens[j + 1]?.kind === ':' && parts.length) {
      parts[parts.length - 1] += '?';
      end = t.end; j++;
      continue;
    }

    // `is` is TypeScript's predicate operator in its admitted type
    // position. Every other alias keeps its token value: boolean words
    // therefore render as TypeScript's `true`/`false` literal types.
    parts.push(t.word === 'is' ? t.word : t.value); end = t.end; j++;
  }

  // A run can only end with `<` still open at end-of-input or a
  // literal-context boundary — every depth-0 stop implies depth 0.
  if (angleOpens.length) unclosedAngle(angleOpens[0]);

  return { parts, consumed: j - startJ, end };
};

// The opaque type string: parts joined and whitespace-normalized
// (cast strings land in the s-expression,
// pinned byte-for-byte by the tests).
const buildTypeString = (parts) => {
  let s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return s
    .replace(/\s*<\s*/g, '<').replace(/\s*>\s*/g, '>')
    .replace(/\s*\[\s*/g, '[').replace(/\s*\]\s*/g, ']')
    .replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*=>\s*/g, ' => ')
    .replace(/ : /g, ': ');
};

// A bare (un-parenthesized) function type in arrow-return position:
// the collector stops at the arrow's own `=>`, so the "type" comes
// back as a parameter list — `(x): (a: T) => R => body` shaped.
// Reject with the fix spelled out.
const looksLikeBareFunctionType = (tokens, a, b) => {
  const isOpen = (t) => t === '(' || t === 'PARAM_START' || t === 'CALL_START';
  const isClose = (t) => t === ')' || t === 'PARAM_END' || t === 'CALL_END';
  if (b - a < 2 || !isOpen(tokens[a].kind)) return false;
  let depth = 0;
  for (let k = a; k < b; k++) {
    if (counter.on) counter.n++;
    const tag = tokens[k].kind;
    if (isOpen(tag)) depth++;
    else if (isClose(tag)) {
      if (--depth === 0 && k !== b - 1) return false;
    }
  }
  if (depth !== 0) return false;
  if (b - a === 2) return true; // empty `()`
  // A `:` directly inside the outer parens ⇒ parameter-list shape; a
  // parenthesized conditional type's else-`:` pairs with a preceding
  // `?` at the same depth and is exempt.
  let d = 0, pendingTernary = false;
  for (let k = a; k < b; k++) {
    if (counter.on) counter.n++;
    const tag = tokens[k].kind;
    if (isOpen(tag) || tag === '[' || tag === '{' || tag === 'INDEX_START') d++;
    else if (isClose(tag) || tag === ']' || tag === '}' || tag === 'INDEX_END') d--;
    else if (d === 1 && (tag === 'TERNARY' || tag === '?')) pendingTernary = true;
    else if (d === 1 && tag === ':') {
      if (pendingTernary) pendingTernary = false;
      else return true;
    }
  }
  return false;
};

// Skip a balanced, unspaced generic group starting at tokens[j]
// (`<…>`; `>>`/`>>>` close two/three levels), returning the index
// AFTER the close — j unchanged when no group opens there, -1 when
// the group breaks its line (generic HEADS are one-line; bodies wrap
// through the type-body floor instead).
const skipAngleGroup = (tokens, j) => {
  if (!(tokens[j]?.kind === 'COMPARE' && tokens[j].value === '<' && !tokens[j].spaced)) return j;
  let depth = 0;
  while (j < tokens.length) {
    if (counter.on) counter.n++;
    const t = tokens[j];
    if (t.kind === 'COMPARE' && t.value === '<') depth++;
    else if (t.kind === 'COMPARE' && t.value === '>') depth--;
    else if (t.kind === 'SHIFT' && t.value === '>>') depth -= 2;
    else if (t.kind === 'SHIFT' && t.value === '>>>') depth -= 3;
    else if (t.kind === 'TERMINATOR' || t.kind === 'INDENT' || t.kind === 'OUTDENT') return -1;
    j++;
    if (depth === 0) break;
  }
  return depth === 0 ? j : -1;
};

// The backward twin: tokens[k] closing a balanced `<…>` group rewinds
// to the index BEFORE its opener (`interface P<T>` → the name); a
// non-close k returns unchanged; -1 when the walk crosses a line
// boundary or never balances.
export const beforeAngleGroupBack = (tokens, k) => {
  if (k < 0 || !tokens[k] || angleWeight(tokens[k]) >= 0) return k;
  let depth = 0;
  while (k >= 0) {
    if (counter.on) counter.n++;
    const t = tokens[k];
    if (t.kind === 'TERMINATOR' || t.kind === 'INDENT' || t.kind === 'OUTDENT') return -1;
    depth += angleWeight(t);
    k--;
    if (depth === 0) break;
  }
  return depth === 0 ? k : -1;
};

// Is tokens[eqIdx] the `=` of a `type Name [<params>] =` alias head at
// a statement boundary? Skips a balanced generic-parameter list back
// to the name.
export const typeAliasEq = (tokens, eqIdx) => {
  // A param list ending in nested generics closes with a merged
  // `>>`/`>>>` token — the rewind must weigh those, so it shares
  // beforeAngleGroupBack rather than counting single `>`s itself.
  const k = beforeAngleGroupBack(tokens, eqIdx - 1);
  if (k < 0 || tokens[k]?.kind !== 'IDENTIFIER') return false;
  const head = tokens[k - 1];
  if (!(head?.kind === 'IDENTIFIER' && head.value === 'type')) return false;
  return atStatementBoundary(tokens, k - 2);
};

// Does the tape end with a '>'/'>>'/'>>>' that closes a GENERIC in a
// type position? Those tokens are UNFINISHED-set members (comparison/
// shift operators normally want a right operand on the next line),
// but a generic close in a type run ends its logical line.
//
// Two answers, cheapest first:
//   BLOCK BODIES — `inTypeBody` (the scanner's type-body floor): at
//     or beyond the indent a verified `type … =` / `interface Name`
//     head opened, EVERYTHING is type text, so a trailing generic
//     close always ends its line — O(1), no walk. This is the only
//     correct answer for a generic WRAPPED across body lines
//     (`Map<K,` + `V>`): its angle imbalance makes any backward walk
//     unclassifiable at the line boundary. Ending the line is safe by
//     construction — the follower either sits at/beyond the body
//     indent (a body-internal TERMINATOR the collector treats as
//     layout) or dedents out structurally; the vocabulary check owns
//     the content either way.
//   ONE-LINE HEADS — classify the head the generic hangs off, at the
//     angle level the trailing close returns to:
//       ':' after a param-list close or a def name — a RETURN type
//         (`def f(a): Map<K, V>` / `(a): Promise<T> ->`);
//       ':' after a name at a statement boundary — a typed
//         DECLARATION or class FIELD line (`r: Map<K, V>`);
//       '=' of a `type Name [<params>] =` head — a one-line ALIAS.
//     A non-matching ':' is transparent (a structural field's colon
//     or a conditional type's else-branch sits INSIDE the run); any
//     line boundary (TERMINATOR/INDENT/OUTDENT) bounds the answer to
//     the logical line. Value-position generics (`x = {k: Map<K, V>`,
//     `foo a<b,` + `c>`) match no head and keep the unfinished-line
//     continuation.
//
//     Computed INCREMENTALLY: a
//     logical line of chained trailing-angle physical lines asks this
//     question once per line, and the original backward walk re-read
//     the whole accumulated line each time — O(n²) over the chain
//     (legal comparison chains included). The memo processes every
//     token ONCE, keyed by the running angle level relative to the
//     line's last boundary: a head token records its decisive answer
//     at its level (later events overwrite — backward-first-match
//     order), transparent colons record nothing, boundaries reset.
//     The query is then one map lookup at the level the trailing
//     close returns to — identical to the walk's depth-0 condition,
//     since a backward walk from the tape end reaches depth 0 exactly
//     at tokens whose running level equals the end's. Bracket closers
//     pop trailing TERMINATORs off the tape; the identity guard
//     detects any such shift and rebuilds from the nearest boundary
//     (one bounded rescan, never a per-line re-walk).
const angleWeight = (t) =>
  t.kind === 'COMPARE' && t.value === '<' ? 1 :
  t.kind === 'COMPARE' && t.value === '>' ? -1 :
  t.kind === 'SHIFT' && t.value === '>>' ? -2 :
  t.kind === 'SHIFT' && t.value === '>>>' ? -3 : 0;

// One ':' head classification: true (a return-type/declaration head),
// false (start of file — decisively no head), or null (transparent —
// a colon inside the type run). Reads earlier tokens only, so the
// answer is immutable once computed.
const classifyTypeColon = (tokens, j) => {
  const before = tokens[j - 1];
  if (!before) return false;
  if (before.kind === ')' || before.kind === 'CALL_END' || before.kind === 'PARAM_END') return true;
  if (before.kind === 'IDENTIFIER' || before.kind === 'PROPERTY') {
    // Parameterless def return type: `def g: Map<K, V>`.
    if (tokens[j - 2]?.kind === 'DEF') return true;
    // Typed declaration / class field: the name sits at a
    // statement boundary (`@`-static names look one further back).
    const nameAt = tokens[j - 2]?.kind === '@' ? j - 3 : j - 2;
    if (atStatementBoundary(tokens, nameAt)) return true;
  }
  // Parameterless VOID def return type: `def tick!: Map<K, V>`.
  if (before.kind === 'VOID_MARKER' && tokens[j - 2]?.kind === 'IDENTIFIER' &&
      tokens[j - 3]?.kind === 'DEF') return true;
  return null;
};

const isLineBoundary = (t) => t.kind === 'TERMINATOR' || t.kind === 'INDENT' || t.kind === 'OUTDENT';

// Advance the memo over tokens it has not seen. `memo` is
// { upTo, ref, level, answers } — tokenize() owns one per run.
const syncTypeGenericMemo = (tokens, memo) => {
  if (memo.upTo > tokens.length || (memo.upTo > 0 && tokens[memo.upTo - 1] !== memo.ref)) {
    // The tape shifted under the memo (a closer popped trailing
    // TERMINATORs): rebuild from the nearest boundary.
    memo.answers.clear();
    memo.level = 0;
    let from = tokens.length - 1;
    while (from >= 0 && !isLineBoundary(tokens[from])) {
      if (counter.on) counter.n++;
      from--;
    }
    memo.upTo = from + 1;
  }
  for (let j = memo.upTo; j < tokens.length; j++) {
    if (counter.on) counter.n++;
    const t = tokens[j];
    if (isLineBoundary(t)) {
      memo.answers.clear();
      memo.level = 0;
      continue;
    }
    const w = angleWeight(t);
    if (w !== 0) memo.level += w;
    else if (t.kind === ':') {
      const a = classifyTypeColon(tokens, j);
      if (a !== null) memo.answers.set(memo.level, a);
    } else if (t.kind === '=') {
      memo.answers.set(memo.level, typeAliasEq(tokens, j));
    } else if (t.kind === 'RESERVED' && t.value === 'interface' && atStatementBoundary(tokens, j - 1)) {
      // A generic interface HEAD ends its line at the head's own
      // angle level (`interface P<T>` / `… extends Q<T>` — the
      // trailing close must end the line so the body INDENT forms).
      memo.answers.set(memo.level, true);
    } else if (t.kind === 'IDENTIFIER' && t.value === 'as' &&
               tokens[j - 1] && tokens[j - 1].kind !== '.' && tokens[j - 1].kind !== '?.' &&
               CAST_LHS_ENDERS.has(tokens[j - 1].kind)) {
      // A postfix-cast head (`expr as Map<K, V>`): the trailing close
      // ends the line the same way a return-type or declaration head
      // does — otherwise the next line continues this one and its
      // statement silently nests into the wrong block.
      memo.answers.set(memo.level, true);
    }
  }
  memo.upTo = tokens.length;
  memo.ref = tokens[tokens.length - 1] ?? null;
};

export const closesTypeGeneric = (tokens, inTypeBody, memo) => {
  const last = tokens[tokens.length - 1];
  if (!last) return false;
  const closer =
    (last.kind === 'COMPARE' && last.value === '>') ||
    (last.kind === 'SHIFT' && (last.value === '>>' || last.value === '>>>'));
  if (!closer) return false;
  if (inTypeBody) return true;
  syncTypeGenericMemo(tokens, memo);
  return memo.answers.get(memo.level) ?? false;
};

// The forward decision for a statement-level `name : …` colon: the
// index of the binding `=` when this is a typed declaration, -1
// otherwise. The reactive assign heads, the readonly head, and the
// effect head bind the same way — `count: number := 0`,
// `total: number ~= e`, `x: number =! 5`, and
// `h: Function ~> body` are typed declarations too (their
// annotations erase identically). A depth-0 `->` before any
// binding token means the value is a function (a method-style binding,
// not a declaration); a depth-0 `=>` switches to the validated
// fn-type-valued form (`get: (p: T) => R = v`), where every candidate
// `=` is accepted only if the slice before it is a complete type
// expression (a generic default's `=` fails the check and the scan
// continues).
const typedDeclEq = (tokens, i) => {
  let depth = 0, sawFatArrow = false;
  for (let j = i + 1; j < tokens.length; j++) {
    if (counter.on) counter.n++;
    const kd = tokens[j].kind;
    if (RUN_OPENERS.has(kd)) depth++;
    else if (RUN_CLOSERS.has(kd)) {
      if (depth === 0) return -1;
      depth--;
    } else if (depth === 0) {
      if (kd === 'TERMINATOR' || kd === 'INDENT' || kd === 'OUTDENT' || kd === '->') return -1;
      if (kd === '=>') sawFatArrow = true;
      else if (kd === '=' || kd === 'REACTIVE_ASSIGN' || kd === 'COMPUTED_ASSIGN' || kd === 'READONLY_ASSIGN' || kd === 'GATE' || kd === 'EFFECT') {
        if (!sawFatArrow || isCompleteTypeExpr(tokens, i + 1, j)) return j;
      }
    }
  }
  return -1;
};

// A bare typed forward declaration (`r: T` alone on its line)
// needs POSITIVE
// evidence that the name is a runtime binding: the same identifier is
// ASSIGNED later in the same block, at any nesting depth reachable
// without crossing a CLOSURE boundary. The boundary is INDENT-based
// (an INDENT directly after `->`/`=>`): a MULTI-LINE arrow body is a
// closure and its assignments never count — but a SINGLE-LINE arrow
// body carries no INDENT at this stage (implicitBlocks runs later),
// so `f = -> r = 5` assigns at the enclosing statement level and DOES
// count. Both spellings are pinned in test/types.test.js.
//
// Built as a LINEAR index over the whole tape (one pass, on the first
// candidate — type-free programs never pay): each block gets a map of
// name → LAST `name =` index, and every assignment registers in its
// own block and each enclosing block up to the nearest closure
// boundary. A candidate is then one lookup: evidence iff the block's
// last assignment of the name sits at or after the scan start. (A
// per-candidate forward scan here would be O(block) each — n
// far-assigned declarations make the pass quadratic.)
const buildAssignIndex = (tokens) => {
  const blockMaps = [new Map()];
  const blockIdAt = new Array(tokens.length);
  // Each frame links UP to its enclosing block, severed at closure
  // boundaries — an assignment registers along its up-chain only.
  const stack = [{ id: 0, up: null }];
  let bracket = 0;
  for (let j = 0; j < tokens.length; j++) {
    if (counter.on) counter.n++;
    const kd = tokens[j].kind;
    blockIdAt[j] = stack[stack.length - 1].id;
    if (kd === 'INDENT') {
      const id = blockMaps.push(new Map()) - 1;
      const p = tokens[j - 1]?.kind;
      const closure = p === '->' || p === '=>';
      stack.push({ id, up: closure ? null : stack[stack.length - 1] });
    } else if (kd === 'OUTDENT') {
      if (stack.length > 1) stack.pop();
    } else if (RUN_OPENERS.has(kd)) {
      bracket++;
    } else if (RUN_CLOSERS.has(kd)) {
      bracket--;
    } else if (bracket === 0 && (kd === 'IDENTIFIER' || kd === 'PROPERTY') &&
        tokens[j + 1]?.kind === '=') {
      for (let f = stack[stack.length - 1]; f; f = f.up) {
        if (counter.on) counter.n++;
        blockMaps[f.id].set(tokens[j].value, j);
      }
    }
  }
  return { blockMaps, blockIdAt };
};

// Does a depth-0 `->`/`=>` appear before this line ends? Then a
// class-body `name: value` is a METHOD pair, never a typed field.
const methodValueAhead = (tokens, j) => {
  let depth = 0;
  for (; j < tokens.length; j++) {
    if (counter.on) counter.n++;
    const kd = tokens[j].kind;
    if (RUN_OPENERS.has(kd)) depth++;
    else if (RUN_CLOSERS.has(kd)) {
      if (depth === 0) return false;
      depth--;
    } else if (depth === 0) {
      if (kd === '->' || kd === '=>') return true;
      if (kd === 'TERMINATOR' || kd === 'INDENT' || kd === 'OUTDENT') return false;
    }
  }
  return false;
};

// The end of a candidate bare-declaration line: the index of the
// depth-0 TERMINATOR that closes it, or -1 when the line opens a
// block, carries a binding `=`, or runs to EOF — none of which is
// the bare form.
const bareDeclLineEnd = (tokens, i) => {
  let depth = 0;
  for (let j = i + 1; j < tokens.length; j++) {
    if (counter.on) counter.n++;
    const kd = tokens[j].kind;
    if (RUN_OPENERS.has(kd)) depth++;
    else if (RUN_CLOSERS.has(kd)) {
      if (depth === 0) return -1;
      depth--;
    } else if (depth === 0) {
      if (kd === 'TERMINATOR') return j;
      if (kd === 'INDENT' || kd === 'OUTDENT' || kd === '=' || kd === 'COMPOUND_ASSIGN' ||
          kd === 'REACTIVE_ASSIGN' || kd === 'COMPUTED_ASSIGN' || kd === 'READONLY_ASSIGN' || kd === 'GATE' || kd === 'EFFECT') return -1;
    }
  }
  return -1;
};

// Statement-clause keywords that can trail a `name: value` line
// (postfix if/unless/while/until/for — rewriteTypes runs before
// tagPostfixConditionals, so a postfix `if` still carries kind IF
// here). A depth-0 clause on a sibling-run member means the line is
// a GUARDED object statement, never a bare typed forward: the member
// disqualifies its whole run from claiming AND from the
// partial-evidence rejection — the guarded reading is legal, not
// ambiguous.
const POSTFIX_CLAUSES = new Set(['IF', 'UNLESS', 'WHILE', 'UNTIL', 'FOR']);
const clauseInLine = (tokens, a, b) => {
  let depth = 0;
  for (let j = a; j < b; j++) {
    if (counter.on) counter.n++;
    const kd = tokens[j].kind;
    if (RUN_OPENERS.has(kd)) depth++;
    else if (RUN_CLOSERS.has(kd)) depth--;
    else if (depth === 0 && POSTFIX_CLAUSES.has(kd)) return true;
  }
  return false;
};

// The matching OUTDENT for the INDENT at tokens[at] (the scanner
// guarantees balance).
const matchingOutdent = (tokens, at) => {
  let depth = 0;
  for (let j = at; j < tokens.length; j++) {
    if (counter.on) counter.n++;
    if (tokens[j].kind === 'INDENT') depth++;
    else if (tokens[j].kind === 'OUTDENT' && --depth === 0) return j;
  }
  return tokens.length - 1;
};

// Value heads inside a param DEFAULT that own a following INDENT — the
// block after them is the default's BODY, not parameter-list layout:
// its separators must not reset the segment and its colons are never
// param annotations. Two disjoint claims, each airtight by grammar
// shape (an over-broad claim exempts the NEXT param's annotation,
// whose un-erased type then falls to implicitObjects as a
// destructuring pattern — a silent miscompile):
//
//   IMMEDIATE heads (`->`/`=>`, do, try, loop) own an INDENT only when
//   it is the literally NEXT surviving token — the head ended its line
//   expecting a block. Any intervening token means the body sat inline
//   (`= -> 5`) and a later INDENT is a new parameter line.
//
//   CONDITION heads (if/unless/switch/while/until/for/class) own a
//   following INDENT only when they open the default's VALUE (directly
//   after the segment's `=` — anywhere else the keyword is postfix)
//   and only until their THEN: a then-form is inline, so its INDENT is
//   layout; a then-less head has NO inline form — the INDENT is
//   necessarily its body.
//
// Only scanner indents exist at this stage (implicitBlocks runs later).
const IMMEDIATE_BODY_HEADS = new Set(['->', '=>', 'DO', 'DO_IIFE', 'TRY', 'LOOP']);
const CONDITION_BODY_HEADS = new Set(['IF', 'UNLESS', 'SWITCH', 'WHILE', 'UNTIL', 'FOR', 'CLASS']);
// Tokens that introduce a single-line BODY within a segment: after one
// of these, a ';' statement separator continues the body (the
// only-a-newline-ends-one rule, mirrored by implicitBlocks), so it
// must not end the parameter segment.
const INLINE_BODY_INTRODUCERS = new Set(['->', '=>', 'THEN', 'ELSE']);

// Tokens that END a class HEAD's armed window (the class-generics
// rejection): statement layout, the body/clause keywords that follow
// a head, operators that take the finished class expression as an
// operand, separators, and string boundaries (interpolation tokens
// carry no RUN depth, so a head can otherwise appear to continue
// across one). EXTENDS, '.', and PROPERTY are deliberately absent —
// they extend the head's parent spine, where `Base<T>` is the same
// misparse.
const CLASS_HEAD_ENDERS = new Set([
  'TERMINATOR', 'INDENT', 'OUTDENT', 'THEN', 'ELSE',
  'IF', 'UNLESS', 'POST_IF', 'POST_UNLESS', 'WHILE', 'UNTIL', 'LOOP',
  'FOR', 'WHEN', 'BY', 'SWITCH', 'RETURN', 'THROW',
  ',', '=', 'COMPOUND_ASSIGN',
  '&&', '||', '??', 'TERNARY', '?', ':', 'RELATION',
  '+', '-', 'MATH', '**', 'SHIFT', '&', '|', '^',
  'STRING_START', 'STRING_END', 'INTERPOLATION_START', 'INTERPOLATION_END',
]);

// Words whose bare READ always lowers to a value token — the BOOL
// aliases plus the literal keywords — mapped to what the read
// becomes. rewriteTypes consults this to reject a binding NAMED for
// one (rejectValueWordBinding): the binding would be unreachable,
// since no read can ever resolve to it.
const VALUE_WORDS = new Map([
  ['yes', 'true'], ['no', 'false'], ['on', 'true'], ['off', 'false'],
  ['true', 'true'], ['false', 'false'],
  ['null', 'null'], ['undefined', 'undefined'], ['this', 'this'],
]);

export function rewriteTypes(tokens, mintId, text, fail) {
  const out = [];
  // Bracket frames over SURVIVING tokens: 'param' (arrow param list),
  // 'defparam' (a def's CALL_START list), 'other'. Param frames carry
  // per-segment state: a segment's colon is an annotation only
  // before its `=` and only once. A segment ends at ANY
  // separator — `,` or the TERMINATOR/layout INDENT/OUTDENT of
  // newline- and semicolon-separated lists — except
  // inside a default-value BODY block (bodyDepth), whose separators
  // belong to the value.
  const frames = [];
  const defParamEnds = new WeakSet(); // CALL_END tokens that close a def param list
  const frameTop = () => frames[frames.length - 1] ?? null;

  // Class-body tracking: CLASS arms the next INDENT as a class BODY
  // (a head line that ends in TERMINATOR or THEN without one has no
  // block body); nested indents inside the body (method bodies,
  // switch arms, defaults) push false. Typed FIELDS claim only when
  // the innermost indent is a class body. Entries carry the body's
  // KIND ('class' | 'component' | false): a class field is read
  // through `@`/`this.` (a property access), but a component member
  // is read BARE in render and methods — so the value-word rejection
  // below must tell them apart.
  let pendingClassBody = false;
  const classIndents = [];
  const inClassBody = () => classIndents.length > 0 && !!classIndents[classIndents.length - 1];
  const classBodyKind = () => classIndents[classIndents.length - 1] ?? false;

  // A bare read of a VALUE WORD lowers to its token before scope
  // exists (`off` → BOOL false, `null` → NULL), so a binding under
  // one of these names is unreachable: every read is the literal,
  // silently. Reject at the site that mints the binding NAME — the
  // annotated-declaration claims below, where key capture is what
  // let the word past classification. Property keys (`{ on: 1 }`),
  // class fields (read `@off`), and promoted params stay legal:
  // their reads are property accesses, which never consult the
  // word tables.
  const rejectValueWordBinding = (nameTok) => {
    const lowered = VALUE_WORDS.get(nameTok.value);
    if (lowered === undefined) return;
    fail(`'${nameTok.value}' cannot name a binding — every read of '${nameTok.value}' ` +
      `lowers to \`${lowered}\`, so the binding would be unreachable`,
      nameTok.start, nameTok.end);
  };

  // Class-HEAD generic tracking: armed at CLASS with the bracket
  // depth the head lives at; a `<` at that depth before the head
  // ends is the class-generics misparse and rejects loudly.
  let classHeadDepth = -1;
  let classHeadRunDepth = 0;

  // Statement-level `name:`-shaped line tracking (outside all
  // brackets): a bare typed declaration never claims NEXT TO another
  // `key:` line — adjacent key lines are an implicit OBJECT (the
  // sibling guard).
  let prevSiblingKV = false, curLineKV = false;

  // The bare-declaration claim's assigned-later evidence: the linear
  // per-block index (buildAssignIndex), built once on the first
  // candidate — every candidate afterwards is one map lookup.
  let assignIndex = null;
  const assignedLater = (start, name) => {
    assignIndex ??= buildAssignIndex(tokens);
    const m = assignIndex.blockMaps[assignIndex.blockIdAt[start]];
    return (m.get(name) ?? -1) >= start;
  };

  // The sibling-run claim: a RUN is the maximal sequence of
  // adjacent statement-level `name:` lines starting at the first bare
  // candidate; typed-declaration lines (typedDeclEq) end the run as
  // separators without joining it. The run decides ALL-OR-NOTHING —
  // splitting it would tear the object reading into fragments:
  //   - every member a bare complete-TYPE line whose name is ASSIGNED
  //     later in the block, and the run's last line NON-TAIL (a
  //     block's last expression stays an implicit-return object) →
  //     every member claims as a typed forward declaration;
  //   - PARTIAL evidence — at least one member type-shaped and at
  //     least one member assigned later, but not every member both —
  //     REJECTS loudly from the first evidence-less member: neither
  //     reading is trustworthy there (the object reading is a
  //     discarded statement reading type names as values; the forward
  //     reading lacks its evidence);
  //   - anything else (no type-shaped member, no assigned name, a
  //     tail run, a non-bare or clause-guarded member) keeps the
  //     implicit-object reading. Requiring an assigned name before
  //     rejecting is
  //     load-bearing: call-argument object blocks sit at statement
  //     boundaries and their evidence is block-scoped, so they can
  //     never bind a run name — without the requirement every
  //     type-shaped call-block object would reject.
  // Decisions are memoized per colon (runClaims), so each run walks
  // once regardless of length.
  let runClaims = null;
  const decideBareRun = (firstColon) => {
    const members = [];
    let colon = firstColon;
    let allBare = true;
    let lastEnd = -1;
    for (;;) {
      if (counter.on) counter.n++;
      const end = bareDeclLineEnd(tokens, colon);
      if (end < 0) {
        if (typedDeclEq(tokens, colon) >= 0) break;
        members.push({ colon, shaped: false, assigned: false });
        allBare = false;
        lastEnd = -1;
        break;
      }
      // A clause-guarded line (`a: number if c`) is a legal guarded
      // object statement — it disqualifies the run without joining
      // the evidence (object reading, never a rejection).
      if (clauseInLine(tokens, colon + 1, end)) {
        members.push({ colon, shaped: false, assigned: false });
        allBare = false;
        lastEnd = -1;
        break;
      }
      members.push({
        colon,
        shaped: end > colon + 1 && isCompleteTypeExpr(tokens, colon + 1, end),
        assigned: assignedLater(end + 1, tokens[colon - 1].value),
      });
      lastEnd = end;
      const nk = tokens[end + 1];
      if (nk && (nk.kind === 'IDENTIFIER' || nk.kind === 'PROPERTY') &&
          tokens[end + 2]?.kind === ':') {
        colon = end + 2;
        continue;
      }
      break;
    }
    const nk = lastEnd >= 0 ? tokens[lastEnd + 1] : null;
    const eligible = allBare && nk != null && nk.kind !== 'OUTDENT';
    const full = eligible && members.every((m) => m.shaped && m.assigned);
    if (!full && eligible &&
        members.some((m) => m.shaped) && members.some((m) => m.assigned)) {
      const m = members.find((x) => !(x.shaped && x.assigned));
      const name = tokens[m.colon - 1];
      const why = m.shaped
        ? `'${name.value}' is never assigned in this block`
        : `the value after '${name.value}:' is not a type`;
      fail(
        `these adjacent 'name:' lines are ambiguous — with every line a type and every ` +
        `name assigned later they would all claim as typed forward declarations, but ${why}; ` +
        `for typed forwards, assign every name in this block or add an initializer ` +
        `('${name.value}: T = value'); for an implicit object, parenthesize the literal ` +
        `or assign it to a target`,
        name.start,
      );
    }
    runClaims ??= new Map();
    for (const m of members) runClaims.set(m.colon, full);
    return full;
  };

  const mint = (kind, value, start, end, like) => ({
    id: mintId(),
    kind, value, start, end,
    spaced: like.spaced,
    newLine: like.newLine,
    generated: false,
    origin: null,
  });

  // Claim a type run starting at tokens[runStart]; the collapsed token
  // spans from `from.start` (the colon or the `as`) through the run's
  // end. Returns the index the main loop resumes AFTER (the last
  // consumed input index), or -1 when there is nothing to claim.
  const claim = (kind, from, runStart, opts) => {
    // A claim whose run BEGINS with another colon (`x: : number`) is
    // the doubled-colon mistake in spaced form — the run would swallow
    // the stray colon as leading type text and emit an invalid face.
    if (tokens[runStart]?.kind === ':') {
      fail("type annotations use a single ':' (e.g. `x: number`), not '::'",
        from.start, tokens[runStart].end);
    }
    const run = collectTypeRun(tokens, runStart, opts, fail);
    if (run.parts.length === 0) return -1;
    // A doubled colon INSIDE the claimed text (`x: typeof Array::slice
    // = v`) rejects at its own position: the scanner's prototype
    // expansion is unmistakable in the run — a `prototype` PROPERTY
    // whose source slice is the two `::` bytes — and type text spells
    // member chains with `.` (a REAL `.prototype.` in the source spans
    // its own nine bytes and never trips this).
    for (let k = runStart; k < runStart + run.consumed; k++) {
      if (counter.on) counter.n++;
      const t = tokens[k];
      if (t.kind === 'PROPERTY' && t.value === 'prototype' && text.slice(t.start, t.end) === '::') {
        fail("type annotations use a single ':' (e.g. `x: number`), not '::'", t.start, t.end);
      }
    }
    if (opts.stopAtFatArrow && looksLikeBareFunctionType(tokens, runStart, runStart + run.consumed)) {
      fail(
        'a function-type return on an arrow must be parenthesized as a whole — ' +
        '`(x): ((a: T) => R) => body`, not `(x): (a: T) => R => body`',
        tokens[runStart].start,
      );
    }
    out.push(mint(kind, buildTypeString(run.parts), from.start, run.end, from));
    return runStart + run.consumed - 1;
  };

  // `type Name [<generics>] = RHS` — the alias claim. Returns the last
  // consumed index, or -1 when the shape is not an alias (a variable
  // named `type` stays an ordinary identifier: no name, or no `=`).
  // A matched head with a malformed RHS fails LOUDLY — never a silent
  // implicit call of a half-eaten line.
  const typeAliasEnd = (i) => {
    let j = i + 1;
    if (tokens[j]?.kind !== 'IDENTIFIER') return -1;
    j++;
    // Optional generic parameter list on the name: balanced `<…>`.
    if (tokens[j]?.kind === 'COMPARE' && tokens[j].value === '<' && !tokens[j].spaced) {
      let depth = 0;
      while (j < tokens.length) {
        if (counter.on) counter.n++;
        const t = tokens[j];
        if (t.kind === 'COMPARE' && t.value === '<') depth++;
        else if (t.kind === 'COMPARE' && t.value === '>') depth--;
        else if (t.kind === 'SHIFT' && t.value === '>>') depth -= 2;
        else if (t.kind === 'SHIFT' && t.value === '>>>') depth -= 3;
        else if (t.kind === 'TERMINATOR' || t.kind === 'INDENT' || t.kind === 'OUTDENT') return -1;
        j++;
        if (depth === 0) break;
      }
    }
    if (tokens[j]?.kind !== '=') return -1;
    j++;
    // Block body (structural type / block union): INDENT … OUTDENT,
    // every interior token checked against the type vocabulary — a
    // code-shaped line (`z = sideEffect()`) rejects loudly instead of
    // erasing with the declaration.
    if (tokens[j]?.kind === 'INDENT') {
      const out = matchingOutdent(tokens, j);
      // Block alias bodies accept METHOD SHORTHAND members
      // (`addItem(item: CartItem): void`) like interface bodies;
      // inline aliases stay expression-shaped (no member rows to
      // host a signature).
      assertTypeVocabulary(tokens, j + 1, out, fail, { methods: true });
      return out;
    }
    // Simple alias: one type run filling the rest of the line, every
    // token in the type vocabulary. A run that stops early — at a
    // statement-clause keyword (`type X = T if c`), a comma — is a
    // malformed alias: rejecting it keeps the clause from silently
    // vanishing into the type string, or
    // the line from compiling as an accidental implicit call.
    const run = collectTypeRun(tokens, j, { alias: true }, fail);
    if (run.parts.length === 0) {
      fail("a type alias needs a type after '='", tokens[j - 1].end);
    }
    assertTypeVocabulary(tokens, j, j + run.consumed, fail);
    const after = tokens[j + run.consumed];
    if (after && after.kind !== 'TERMINATOR' && after.kind !== 'OUTDENT') {
      fail(`a type alias must fill its line — unexpected '${after.value}' after the type`, after.start);
    }
    return j + run.consumed - 1;
  };

  // `interface Name[<params>] [extends Name[<args>]] INDENT … OUTDENT`
  // — the interface claim; every member token checked against the type
  // vocabulary, with METHOD SHORTHAND members (`m(x: number): void`)
  // legal here and in BLOCK alias bodies;
  // inline aliases reject the spelling.
  // Generic name/parent groups are balanced one-line `<…>` runs (the
  // alias head's treatment).
  // Bodiless or otherwise malformed shapes return -1: the RESERVED
  // token survives the pass and rejects loudly from its own position.
  const interfaceEnd = (i) => {
    let j = i + 1;
    if (tokens[j]?.kind !== 'IDENTIFIER') return -1;
    j++;
    j = skipAngleGroup(tokens, j);
    if (j === -1) return -1;
    if (tokens[j]?.kind === 'EXTENDS') {
      if (tokens[j + 1]?.kind !== 'IDENTIFIER') return -1;
      j += 2;
      j = skipAngleGroup(tokens, j);
      if (j === -1) return -1;
    }
    if (tokens[j]?.kind !== 'INDENT') return -1;
    const out = matchingOutdent(tokens, j);
    assertTypeVocabulary(tokens, j + 1, out, fail, { methods: true });
    return out;
  };

  for (let i = 0; i < tokens.length; i++) {
    if (counter.on) counter.n++;
    const tok = tokens[i];
    const kd = tok.kind;
    const prev = out[out.length - 1] ?? null;

    // ── `type Name = …` / `interface Name` — whole-statement type
    // declarations. The entire declaration collapses into ONE
    // TYPE_DECL token whose value is the raw source text (opaque to
    // the grammar; declaration emission — src/ts/dts.js — structures
    // it); the grammar reduces it to an erased statement node
    // carrying the span. An `export` prefix folds in — the whole
    // exported declaration erases.
    if (frames.length === 0 &&
        ((kd === 'IDENTIFIER' && tok.value === 'type') ||
         (kd === 'RESERVED' && tok.value === 'interface')) &&
        (!prev || prev.kind === 'TERMINATOR' || prev.kind === 'INDENT' ||
         prev.kind === 'OUTDENT' || prev.kind === 'EXPORT')) {
      const last = kd === 'IDENTIFIER' ? typeAliasEnd(i) : interfaceEnd(i);
      if (last >= 0) {
        const from = prev?.kind === 'EXPORT' ? out.pop() : tok;
        const end = tokens[last].end;
        // The VALUE normalizes \r\n to \n (the heredoc-value rule: a
        // CRLF file is the same program); the SPAN stays raw.
        out.push(mint('TYPE_DECL', text.slice(from.start, end).replace(/\r\n/g, '\n'), from.start, end, tok));
        i = last;
        continue;
      }
    }

    // ── `expr as Type` — the postfix cast ──────────────────────────
    if (kd === 'IDENTIFIER' && tok.value === 'as' &&
        prev && prev.kind !== '.' && prev.kind !== '?.' && CAST_LHS_ENDERS.has(prev.kind) &&
        tokens[i + 1] && (TYPE_STARTERS.has(tokens[i + 1].kind) ||
          // A signed numeric literal enters the cast reading too:
          // `-1` claims, `+1` rejects inside the run with the fix.
          (tokens[i + 1].kind === '+' && tokens[i + 2]?.kind === 'NUMBER'))) {
      const last = claim('CAST', tok, i + 1, { cast: true });
      // The trigger committed the cast reading (a value ender, `as`,
      // a type starter); a run that then claims NOTHING must reject
      // here — falling through would read `as` as a plain identifier
      // and emit a CALL of the left operand.
      if (last < 0) {
        fail("'as' begins a cast and takes a type — `x as T`", tok.start, tok.end);
      }
      if (last >= 0) {
        i = last;
        // A type ending in `>` (COMPARE — an unfinished-line kind)
        // suppressed the statement's TERMINATOR at scan time; once the
        // run is collapsed the next line would collide with this one.
        // Restore the separator the scanner ate.
        const follow = tokens[i + 1];
        const cast = out[out.length - 1];
        if (follow && follow.newLine &&
            follow.kind !== 'TERMINATOR' && follow.kind !== 'INDENT' && follow.kind !== 'OUTDENT' &&
            !(follow.kind === 'IDENTIFIER' && follow.value === 'as')) {
          const gap = text.slice(cast.end, follow.start);
          const nl = gap.indexOf('\n');
          if (nl >= 0) {
            const crlf = gap[nl - 1] === '\r';
            const at = cast.end + nl - (crlf ? 1 : 0);
            const len = crlf ? 2 : 1;
            out.push({
              id: mintId(), kind: 'TERMINATOR', value: text.slice(at, at + len),
              start: at, end: at + len, spaced: false, newLine: false,
              generated: true, origin: null,
            });
          }
        }
        continue;
      }
    }

    // Generic parameter list: an
    // unspaced `<` after a DEF's name (`def wrap<T extends string>(…)`)
    // or on a component declaration's target (`Select<T> = component…`)
    // collapses its balanced angle run into ONE TYPE_PARAMS token —
    // opaque text the grammar drops as the side-band typeParams role;
    // the TS face re-emits it after the name, type-level only.
    if (kd === 'COMPARE' && tok.value === '<' && !tok.spaced &&
        prev && prev.kind === 'IDENTIFIER') {
      const beforeName = out[out.length - 2] ?? null;
      let depth = 0;
      let j = i;
      while (j < tokens.length) {
        const t = tokens[j];
        if (t.kind === 'COMPARE' && t.value === '<') depth++;
        else if (t.kind === 'COMPARE' && t.value === '>') depth--;
        else if (t.kind === 'SHIFT' && t.value === '>>') depth -= 2;
        else if (t.kind === 'SHIFT' && t.value === '>>>') depth -= 3;
        else if (t.kind === 'TERMINATOR' || t.kind === 'INDENT' || t.kind === 'OUTDENT') { j = -1; break; }
        if (depth === 0) break;
        j++;
      }
      if (j > i) {
        const afterClose = tokens[j + 1]?.kind;
        const isDefName = beforeName?.kind === 'DEF';
        const isComponentTarget = afterClose === '=' && tokens[j + 2]?.kind === 'COMPONENT';
        if (isDefName || isComponentTarget) {
          // The def's param paren scanned PLAIN (the scanner mints
          // CALL_START only directly after a name) — retype it and
          // its mate so the defparam frame and the return-type claim
          // see the ordinary shapes.
          if (isDefName && afterClose === '(') {
            let d = 0;
            for (let k = j + 1; k < tokens.length; k++) {
              const t = tokens[k];
              if (t.kind === '(' || t.kind === 'CALL_START' || t.kind === 'PARAM_START') d++;
              else if (t.kind === ')' || t.kind === 'CALL_END' || t.kind === 'PARAM_END') {
                if (--d === 0) { tokens[j + 1].kind = 'CALL_START'; t.kind = 'CALL_END'; break; }
              }
            }
          }
          out.push(mint('TYPE_PARAMS', text.slice(tok.start, tokens[j].end), tok.start, tokens[j].end, tok));
          i = j;
          continue;
        }
      }
    }

    // Bare optional parameter: `title?` directly
    // before a list separator or close in a param frame — the `?` is
    // the optional marker, not postfix existence (which would test a
    // parameter that cannot have a value yet). Retype so the grammar's
    // OPT_MARKER production claims it.
    if (kd === '?' && prev && (prev.kind === 'PROPERTY' || prev.kind === 'IDENTIFIER')) {
      const f = frameTop();
      const nk = tokens[i + 1]?.kind;
      if (f && (f.kind === 'param' || f.kind === 'defparam') &&
          !f.sawEq && f.bodyDepth === 0 && !f.inlineBody &&
          (nk === ',' || nk === 'PARAM_END' || nk === 'CALL_END' || nk === ')' || nk === 'TERMINATOR' || nk === 'OUTDENT')) {
        tok.kind = 'OPT_MARKER';
        if (prev.kind === 'PROPERTY') prev.kind = 'IDENTIFIER';
      }
    }

    // ── single-colon annotations ───────────────────────────────────
    if (kd === ':' && prev) {
      const f = frameTop();
      const beforePrev = out[out.length - 2] ?? null;

      // Return type on an arrow: `(params): T ->` / `(params): T =>`.
      // The trailing arrow is the arrow OPERATOR, so the run stops at
      // a depth-0 `=>` too (and the bare-function-type guard applies).
      if (prev.kind === 'PARAM_END') {
        const last = claim('TYPE', tok, i + 1, { stopAtFatArrow: true });
        if (last >= 0) { i = last; continue; }
      }

      // Return type on a def with parameters: `def f(…): T`.
      if (prev.kind === 'CALL_END' && defParamEnds.has(prev)) {
        const last = claim('TYPE', tok, i + 1, {});
        if (last >= 0) { i = last; continue; }
      }

      // Return type on a parameterless def: `def f: T`.
      if ((prev.kind === 'PROPERTY' || prev.kind === 'IDENTIFIER') && beforePrev?.kind === 'DEF') {
        const last = claim('TYPE', tok, i + 1, {});
        if (last >= 0) {
          if (prev.kind === 'PROPERTY') {
            rejectValueWordBinding(prev);
            prev.kind = 'IDENTIFIER';
          }
          i = last;
          continue;
        }
      }

      // Return type on a parameterless VOID def: `def tick!: T`.
      if (prev.kind === 'VOID_MARKER' && beforePrev?.kind === 'IDENTIFIER' &&
          out[out.length - 3]?.kind === 'DEF') {
        const last = claim('TYPE', tok, i + 1, {});
        if (last >= 0) { i = last; continue; }
      }

      // Parameter annotation: `(a: T)`, `(a: T = d)`, `def f(a: T)`,
      // and the root-pattern form `({a, b}: T)` (the pattern's own
      // brackets already popped, so a rename's colon inside the
      // pattern never reaches here with a param frame on top). First
      // colon per segment, before the segment's `=`, never inside a
      // default's body block (indented or inline).
      if (f && (f.kind === 'param' || f.kind === 'defparam') &&
          !f.sawEq && !f.sawType && f.bodyDepth === 0 && !f.inlineBody) {
        const namable = prev.kind === 'PROPERTY' || prev.kind === 'IDENTIFIER';
        const patternClose = prev.kind === '}' || prev.kind === ']';
        // Optional parameter: `title?: string` — in
        // param position the scanner minted the unspaced `?` as the
        // existence operator (the OPT_MARKER name-slot rule sees
        // statement/member positions only); a following annotation
        // colon disambiguates, so retype it here and claim the type.
        const optMarker = prev.kind === '?' &&
          (beforePrev?.kind === 'PROPERTY' || beforePrev?.kind === 'IDENTIFIER');
        if (namable || patternClose || optMarker) {
          const last = claim('TYPE', tok, i + 1, {});
          if (last >= 0) {
            if (optMarker) {
              prev.kind = 'OPT_MARKER';
              if (beforePrev.kind === 'PROPERTY') beforePrev.kind = 'IDENTIFIER';
            } else if (prev.kind === 'PROPERTY' &&
                       tokens[i - 2]?.kind !== '@') {
              // A promoted parameter's name stays PROPERTY — the
              // ThisProperty grammar reads `@ Property` (`(@url:
              // string)`); every other annotated param name reads
              // as a plain Identifier.
              rejectValueWordBinding(prev);
              prev.kind = 'IDENTIFIER';
            }
            f.sawType = true;
            i = last;
            continue;
          }
        }
      }

      // Track `name:`-shaped statement lines for the bare-declaration
      // sibling logic below — set BEFORE any claim; a line that CLAIMS
      // (typed declaration or bare forward) resets it, so claimed
      // lines never count as object siblings and bare forwards
      // interleave freely with annotated assignments. An
      // OPT_MARKER between the name and its colon is TRANSPARENT to
      // the typed claims (`@name?: string := v` — the declaration
      // rows drop the real token as a side-band role).
      const marker = prev.kind === 'OPT_MARKER' ? 1 : 0;
      const nameTok = marker ? (out[out.length - 2] ?? null) : prev;
      const isAtName = (out[out.length - 2 - marker] ?? null)?.kind === '@';
      const nameBoundaryAt = out.length - (isAtName ? 3 : 2) - marker;
      const namedColon = nameTok !== null && (nameTok.kind === 'PROPERTY' || nameTok.kind === 'IDENTIFIER') &&
        atStatementBoundary(out, nameBoundaryAt);
      // A STRING name takes annotations too — the typed string-named
      // class field (`"data-src": string = "v"`) — but ONLY for the
      // full `: T =` claim below: a bare `"lit": v` line stays the
      // implicit object it always was.
      const stringNamedColon = nameTok !== null && nameTok.kind === 'STRING' &&
        atStatementBoundary(out, nameBoundaryAt);
      if (frames.length === 0 && namedColon && !isAtName) curLineKV = true;

      // An annotated SOAK prototype write (`X?::m: T = v`): the
      // augmentation declares that the member EXISTS on the type — a
      // conditional write cannot carry that claim. Reject shaped,
      // naming the fix.
      if (frames.length === 0 && prev.kind === 'PROPERTY' &&
          out[out.length - 2]?.kind === '.' &&
          out[out.length - 3]?.kind === 'PROPERTY' && out[out.length - 3].value === 'prototype' &&
          out[out.length - 4]?.kind === '?.' &&
          out[out.length - 5]?.kind === 'IDENTIFIER' &&
          atStatementBoundary(out, out.length - 6) &&
          typedDeclEq(tokens, i) >= 0) {
        fail('an annotated prototype member requires the unconditional chain (`X::m: T = v`) — ' +
          'the soak form cannot carry the annotation', tok.start, tok.end);
      }

      // Typed prototype member: `X.prototype.m: T = v` (the `::`
      // spelling reads identically after the scanner's expansion) at a
      // statement boundary. The chain shape is exact — head
      // identifier, `prototype`, member — and the annotation drives
      // the face's interface augmentation, so hovers and calls of the
      // added member resolve to the declared type. The member keeps
      // its PROPERTY tag (the member-chain grammar shape requires it).
      if (frames.length === 0 && prev.kind === 'PROPERTY' &&
          out[out.length - 2]?.kind === '.' &&
          out[out.length - 3]?.kind === 'PROPERTY' && out[out.length - 3].value === 'prototype' &&
          out[out.length - 4]?.kind === '.' &&
          out[out.length - 5]?.kind === 'IDENTIFIER' &&
          atStatementBoundary(out, out.length - 6) &&
          typedDeclEq(tokens, i) >= 0) {
        const last = claim('TYPE', tok, i + 1, {});
        if (last >= 0) { i = last; continue; }
      }

      // Statement-level typed declaration: `name: T = v` at a
      // statement boundary, outside all brackets, with the binding `=`
      // decided by the forward scan (typedDeclEq). `@`-prefixed names
      // claim too (`@x: T = v` — the target is the ThisProperty) and
      // keep their PROPERTY tag, as the `@ Property` grammar shape
      // requires.
      if (frames.length === 0 && (namedColon || stringNamedColon) && typedDeclEq(tokens, i) >= 0) {
        const last = claim('TYPE', tok, i + 1, {});
        if (last >= 0) {
          if (nameTok.kind === 'PROPERTY' && !isAtName) {
            // A class FIELD so named stays reachable (`@off` reads it);
            // a component member's reads are bare, a statement
            // binding's always are — both reject.
            if (classBodyKind() !== 'class') rejectValueWordBinding(nameTok);
            nameTok.kind = 'IDENTIFIER';
          }
          curLineKV = false;
          i = last;
          continue;
        }
      }

      // Class-body bare typed FIELD: `name: T` / `@name: T`
      // with no initializer claims when the line is a complete TYPE
      // and the value is not a method. Initializer forms claim through
      // the statement-declaration branch above. Only type-shaped lines
      // claim — a value there (`x: f()`) stays an object pair and
      // rejects loudly at the emitter.
      if (frames.length === 0 && inClassBody() && namedColon &&
          !methodValueAhead(tokens, i + 1)) {
        let end = -1, depth = 0;
        for (let j = i + 1; j < tokens.length; j++) {
          if (counter.on) counter.n++;
          const t2 = tokens[j].kind;
          if (RUN_OPENERS.has(t2)) depth++;
          else if (RUN_CLOSERS.has(t2)) {
            if (depth === 0) break;
            depth--;
          } else if (depth === 0) {
            if (t2 === 'TERMINATOR' || t2 === 'OUTDENT') { end = j; break; }
            if (t2 === 'INDENT' || t2 === '=' || t2 === 'COMPOUND_ASSIGN' ||
                t2 === 'REACTIVE_ASSIGN' || t2 === 'COMPUTED_ASSIGN' || t2 === 'READONLY_ASSIGN' || t2 === 'GATE' || t2 === 'EFFECT') break;
          }
        }
        if (end > i + 1 && isCompleteTypeExpr(tokens, i + 1, end)) {
          const last = claim('TYPE', tok, i + 1, {});
          if (last >= 0) {
            if (nameTok.kind === 'PROPERTY' && !isAtName) {
              // Same split as the initializer claim above: a class
              // field's reads are property accesses; a component
              // member's are bare.
              if (classBodyKind() === 'component') rejectValueWordBinding(nameTok);
              nameTok.kind = 'IDENTIFIER';
            }
            i = last;
            continue;
          }
        }
      }

      // Bare typed forward declarations (`r: T` alone on its line):
      // plain names at a statement boundary decide
      // as a sibling RUN (decideBareRun) — every member a
      // complete TYPE line whose name is ASSIGNED later in the block,
      // the run's last line NON-TAIL → every member claims; partial
      // evidence rejects loudly; otherwise the run keeps its
      // implicit-object reading. The claim erases to NOTHING at
      // emission.
      if (frames.length === 0 && !inClassBody() && namedColon && !isAtName && !marker) {
        const cached = runClaims?.get(i);
        const decision = cached !== undefined ? cached
          : (!prevSiblingKV && decideBareRun(i));
        if (decision) {
          const last = claim('TYPE', tok, i + 1, {});
          if (last >= 0) {
            if (prev.kind === 'PROPERTY') {
              rejectValueWordBinding(prev);
              prev.kind = 'IDENTIFIER';
            }
            curLineKV = false;
            i = last;
            continue;
          }
        }
      }
    }

    // ── class-HEAD generic rejection ───────────────────────────────
    // A `<` at the head's own bracket depth — `class Box<T>`, the
    // parent form `extends Base<T>`, the anonymous `class <T>` —
    // parses as a COMPARISON, and the chained-comparison lowering
    // makes the head compile to garbage
    // (`(class Box {} < T) && (T > {…})`): a silent miscompile.
    // Class generics are unsupported (types erase — a generic list
    // has no runtime meaning), so the `<` rejects loudly from its
    // own position. No legal `<` lives at head depth: the head
    // grammar is `class [Name] [extends Parent]`, brackets carry
    // their own depth, and every token that can legally follow a
    // class head (statement layout, clause keywords, operators that
    // take the class expression as an operand, string boundaries)
    // ends the armed window first.
    if (RUN_OPENERS.has(kd)) classHeadRunDepth++;
    else if (RUN_CLOSERS.has(kd)) {
      classHeadRunDepth--;
      if (classHeadDepth >= 0 && classHeadRunDepth < classHeadDepth) classHeadDepth = -1;
    }
    if (kd === 'CLASS') classHeadDepth = classHeadRunDepth;
    else if (classHeadDepth >= 0 && classHeadRunDepth === classHeadDepth) {
      if (kd === 'COMPARE' && tok.value === '<') {
        fail(
          "class generics are not supported — the class head's '<' parses as a comparison " +
          'and the statement miscompiles silently (`class Box<T>` compiles to ' +
          '`(class Box {} < T) && …`); remove the generic list',
          tok.start,
        );
      }
      if (CLASS_HEAD_ENDERS.has(kd)) classHeadDepth = -1;
    }

    // ── class-body and statement-line tracking ─────────────────────
    // CLASS arms the next INDENT as a class body; TERMINATOR/THEN
    // disarm (the head line ended without a block body). COMPONENT
    // arms the same context: a component body takes bare
    // typed FIELDS by the class rule (`@size: number` is a required
    // typed prop — the claim builds the typed-var wrapper the member
    // categorizer reads). Consumed claims never reach here, but every
    // run they eat is INDENT/OUTDENT-balanced, so the stack stays
    // true.
    if (kd === 'CLASS' || kd === 'COMPONENT') pendingClassBody = kd === 'CLASS' ? 'class' : 'component';
    else if (kd === 'THEN') pendingClassBody = false;
    else if (kd === 'INDENT') {
      classIndents.push(pendingClassBody);
      pendingClassBody = false;
    } else if (kd === 'OUTDENT') {
      classIndents.pop();
    } else if (kd === 'TERMINATOR') {
      pendingClassBody = false;
    }
    if (frames.length === 0) {
      if (kd === 'TERMINATOR') {
        prevSiblingKV = curLineKV;
        curLineKV = false;
      } else if (kd === 'INDENT' || kd === 'OUTDENT') {
        prevSiblingKV = false;
        curLineKV = false;
      }
    }

    // ── frame maintenance over surviving tokens ────────────────────
    if (RUN_OPENERS.has(kd)) {
      let fk = 'other';
      if (kd === 'PARAM_START') fk = 'param';
      else if (kd === 'CALL_START' && prev?.kind === 'IDENTIFIER' && out[out.length - 2]?.kind === 'DEF') fk = 'defparam';
      // Generic def: the minted TYPE_PARAMS sits between the name and
      // its param list.
      else if (kd === 'CALL_START' && prev?.kind === 'TYPE_PARAMS' &&
               out[out.length - 2]?.kind === 'IDENTIFIER' && out[out.length - 3]?.kind === 'DEF') fk = 'defparam';
      // Void def (`def save!(x)`): the VOID_MARKER sits between the
      // def name and its param list.
      else if (kd === 'CALL_START' && prev?.kind === 'VOID_MARKER' &&
               out[out.length - 2]?.kind === 'IDENTIFIER' && out[out.length - 3]?.kind === 'DEF') fk = 'defparam';
      frames.push({
        kind: fk, sawEq: false, sawType: false, bodyDepth: 0,
        pendingImmediate: false, pendingCond: false, inlineBody: false,
      });
    } else if (RUN_CLOSERS.has(kd)) {
      const open = frames.pop();
      if (open?.kind === 'defparam' && kd === 'CALL_END') defParamEnds.add(tok);
    } else {
      const f = frameTop();
      if (f && (f.kind === 'param' || f.kind === 'defparam')) {
        // A segment ends at any list separator: `,`, the newline
        // TERMINATOR of newline-separated params, or a layout
        // INDENT/OUTDENT (a deeper continuation line starts a new
        // segment).
        const segmentReset = () => {
          f.sawEq = false;
          f.sawType = false;
          f.pendingImmediate = false;
          f.pendingCond = false;
          f.inlineBody = false;
        };
        if (f.bodyDepth > 0) {
          // Inside a default's body block: its INDENT/OUTDENT nest and
          // its separators belong to the value, not the list.
          if (kd === 'INDENT') f.bodyDepth++;
          else if (kd === 'OUTDENT') f.bodyDepth--;
        } else if (kd === 'INDENT') {
          // A pending head claims THIS indent as its body; any other
          // indent is parameter-list layout.
          if (f.pendingImmediate || f.pendingCond) {
            f.bodyDepth = 1;
            f.pendingImmediate = false;
            f.pendingCond = false;
            f.inlineBody = false;
          } else {
            segmentReset();
          }
        } else if (kd === ',' || kd === 'OUTDENT') {
          segmentReset();
        } else if (kd === 'TERMINATOR') {
          // A ';' after an inline body CONTINUES the body (the
          // only-a-newline-ends-a-single-liner rule, which
          // implicitBlocks applies later): `(a = -> 5; b: 1)` keeps
          // `b: 1` inside the arrow's returned object. A newline
          // TERMINATOR ends both the body and the segment.
          if (f.inlineBody && tok.value === ';') {
            f.pendingImmediate = false;
            f.pendingCond = false;
          } else {
            segmentReset();
          }
        } else {
          // The immediate claim survives ONLY to the very next token.
          f.pendingImmediate = IMMEDIATE_BODY_HEADS.has(kd);
          if (CONDITION_BODY_HEADS.has(kd) && prev?.kind === '=') f.pendingCond = true;
          else if (kd === 'THEN') f.pendingCond = false;
          if (INLINE_BODY_INTRODUCERS.has(kd)) f.inlineBody = true;
          if (kd === '=') f.sawEq = true;
        }
      }
    }

    out.push(tok);
  }

  // Same array identity — callers hold the reference. Indexed copy,
  // never a spread: `push(...out)` passes every token as a CALL
  // ARGUMENT and overflows the stack past ~1.2M tokens.
  tokens.length = out.length;
  for (let i = 0; i < out.length; i++) {
    if (counter.on) counter.n++;
    tokens[i] = out[i];
  }
  return tokens;
}
