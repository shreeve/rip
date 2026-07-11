// Offset-native lexer for Rip.
//
// Produces a TokenTape: a flat array of token records with [start, end)
// UTF-16 code-unit spans, plus a parallel trivia channel (comments and
// blank-line runs, retained with spans, never fed to the parser).
//
// Token record: { id, kind, value, start, end, spaced, newLine, generated, origin }
//   - id:        stable identity — dense int in creation order. Insertion
//                passes mint fresh ids; ids never change and indices are
//                never stored.
//   - spaced:    preceded by horizontal whitespace
//   - newLine:   first token of its logical line
//   - generated: synthesized token (INDENT/OUTDENT/TERMINATOR carry no
//                source text of their own beyond the newline)
//   - origin:    for synthesized tokens, the ID of the first real
//                (non-generated) token that follows — the token that
//                triggered synthesis; null otherwise
//
// INDENT carries a zero-width span at the first real token of the deeper
// line; OUTDENT carries a zero-width span at the END of the block's last
// real token — so a block's $self span covers exactly its content: no
// leading indentation, no trailing blank/comment lines ($self
// coverage). TERMINATOR carries the span of the newline character
// that ended the previous logical line.
//
// Coverage: identifiers, properties, numbers, simple strings,
// comments, the operators the grammar needs, indentation blocks,
// and call-paren disambiguation ('(' directly after a callable token with
// no space becomes CALL_START, paired closer becomes CALL_END).

import { SourceFile } from './source.js';
import { rewriteSchema } from './schema.js';
import { rewriteRender } from './render.js';
import { TEMPLATE_TAGS } from './dom-vocab.js';
import { ops, syncOpsFlag } from './ops.js';

// ── Pipeline: post-scan passes ──────────────────────────────────────────
// A retag pass takes the finished TokenTape and changes token KINDS in
// place — never inserts or deletes records — so tape indices and origins
// stay stable by construction. Passes that add tokens are collectors
// applied through applyInsertionPass (below), never direct mutators.

// Arrow-function parameter tagging: when
// an arrow follows a `)`, the matching plain `(` … `)` pair retags to
// PARAM_START … PARAM_END. A CALL_START match means the parens belong to
// a call — the arrow is parameterless and nothing retags. A DO directly
// before the function (its arrow, or its param list's opener) retags to
// DO_IIFE — `do ->` and `do (x) ->` are the immediate-invocation forms.
export function tagParams(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    if (ops.on) ops.n++;
    const kind = tokens[i].kind;
    if (kind !== '->' && kind !== '=>') continue;
    let closeAt = i - 1;
    let close = tokens[closeAt];
    if (!close) continue;
    if (close.kind === 'DO') {
      close.kind = 'DO_IIFE';
      continue;
    }
    if (close.kind !== ')') {
      // A return-type annotation may sit between the param close and
      // the arrow: `(a): T ->`. Scan backward over the (balanced) type
      // run for a depth-0 ':' directly after ')' — that ')' is the
      // param-list close. rewriteTypes
      // runs later and reads the PARAM_END this pass creates.
      let depth = 0;
      let found = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (ops.on) ops.n++;
        const t = tokens[j];
        const k = t.kind;
        if (k === ')' || k === ']' || k === '}' || k === 'PICK_END' || k === 'CALL_END' || k === 'PARAM_END' || k === 'INDEX_END' ||
            (k === 'COMPARE' && t.value === '>')) {
          depth++;
        } else if (k === '(' || k === '[' || k === '{' || k === 'PICK_START' || k === 'OPTPICK_START' || k === 'CALL_START' || k === 'PARAM_START' || k === 'INDEX_START' ||
                   (k === 'COMPARE' && t.value === '<')) {
          depth--;
        } else if (k === 'SHIFT' && t.value === '>>') depth += 2;
        else if (k === 'SHIFT' && t.value === '>>>') depth += 3;
        else if (depth === 0) {
          if (k === ':') {
            if (tokens[j - 1]?.kind === ')') found = j - 1;
            break;
          }
          if (k === 'TERMINATOR' || k === 'INDENT' || k === 'OUTDENT' || k === '=' || k === '->' || k === '=>') break;
        }
      }
      if (found < 0) continue;
      closeAt = found;
      close = tokens[closeAt];
    } else {
      // The ')' before the arrow can close a PARENTHESIZED return
      // type: `(x): (R) =>`. If a ':' preceded by ')' sits before this
      // group's '(', the real param close is that earlier ')'.
      let d = 0;
      let op = -1;
      for (let k = i - 1; k >= 0; k--) {
        if (ops.on) ops.n++;
        const kk = tokens[k].kind;
        if (kk === ')' || kk === 'CALL_END' || kk === 'PARAM_END') d++;
        else if (kk === '(' || kk === 'CALL_START' || kk === 'PARAM_START') {
          if (--d === 0) {
            op = k;
            break;
          }
        }
      }
      if (op > 1 && tokens[op - 1].kind === ':' && tokens[op - 2]?.kind === ')') {
        closeAt = op - 2;
        close = tokens[closeAt];
      }
    }
    let depth = 0;
    for (let j = closeAt - 1; j >= 0; j--) {
      if (ops.on) ops.n++;
      const t = tokens[j];
      if (t.kind === ')' || t.kind === 'CALL_END' || t.kind === 'INDEX_END' || t.kind === ']') {
        depth++;
      } else if (t.kind === '(' || t.kind === 'CALL_START' || t.kind === 'INDEX_START' || t.kind === '[') {
        if (depth > 0) {
          depth--;
          continue;
        }
        if (t.kind === '(') {
          t.kind = 'PARAM_START';
          close.kind = 'PARAM_END';
          if (tokens[j - 1]?.kind === 'DO') tokens[j - 1].kind = 'DO_IIFE';
        }
        break;
      }
    }
  }
  return tokens;
}

// Dynamic-key detection: an INDEX pair whose closing bracket is directly
// followed by ':' is an object KEY (`{@[k]: v}`, `{a[i]: v}` shapes), not
// an index — both brackets retag to their plain kinds so the grammar's
// dynamic-key rules see `[ Expression ]`. The one ':' that must NOT
// trigger this is a ternary's: a pending TERNARY at the same bracket
// depth claims the next ':' there (`a ? b[k] : c` keeps its index). The
// inner matching scan is O(pair length) per INDEX_START — quadratic only
// for pathologically nested index chains, linear for normal programs
// (the tagPostfixConditionals bound).
export function tagDynamicKeys(tokens) {
  const OPENERS = new Set(['(', '[', '{', 'PICK_START', 'OPTPICK_START', 'CALL_START', 'INDEX_START', 'PARAM_START', 'STRING_START', 'INTERPOLATION_START', 'HEREGEX_START', 'INDENT']);
  const CLOSERS = new Set([')', ']', '}', 'PICK_END', 'CALL_END', 'INDEX_END', 'PARAM_END', 'STRING_END', 'INTERPOLATION_END', 'HEREGEX_END', 'OUTDENT']);
  const pendingTernary = [0]; // per bracket depth
  for (let i = 0; i < tokens.length; i++) {
    if (ops.on) ops.n++;
    const k = tokens[i].kind;
    if (k === 'TERNARY') {
      pendingTernary[pendingTernary.length - 1]++;
    } else if (k === ':' || k === 'TERMINATOR') {
      // A ':' satisfies the innermost pending ternary at this depth; a
      // statement boundary clears any unconsumed ones.
      const top = pendingTernary.length - 1;
      if (k === 'TERMINATOR') pendingTernary[top] = 0;
      else if (pendingTernary[top] > 0) pendingTernary[top]--;
    } else if (k === 'INDEX_START' && pendingTernary[pendingTernary.length - 1] === 0) {
      let depth = 1;
      let j = i;
      while (++j < tokens.length && depth > 0) {
        if (ops.on) ops.n++;
        if (OPENERS.has(tokens[j].kind)) depth++;
        else if (CLOSERS.has(tokens[j].kind)) depth--;
      }
      // j sits one past the close when depth reached 0.
      if (depth === 0 && tokens[j]?.kind === ':') {
        tokens[i].kind = '[';
        tokens[j - 1].kind = ']';
      }
    }
    if (OPENERS.has(tokens[i].kind)) pendingTernary.push(0);
    else if (CLOSERS.has(tokens[i].kind)) pendingTernary.pop();
  }
  return tokens;
}

// ── Definition-site void markers ─────────────────────────────────────
// A trailing `!` on a function's NAME at a definition site means the
// function is VOID (implicit return suppressed). The scanner mints
// every unspaced post-name `!` as DAMMIT (call-plus-await sugar); this
// retag pass resolves the two definition contexts one adjacency check
// decides — the SLR table cannot (an `Identifier . DAMMIT` state would
// need the token AFTER the bang to choose between the dammit reduce
// and a definition shift):
//   - assign definition: DAMMIT directly before a `=` token
//     (`save! = ->`; a spaced `!` never lexes DAMMIT, `!=` after a
//     name is a scan-time rejection, `==` lexes COMPARE whole)
//   - def definition: DEF Identifier DAMMIT (`def save!(x)`)
// The third context — an object/class METHOD KEY (`fn!: ->`) — resolves
// inside implicitObjects, the pass that knows whether a `:` is a
// ternary's (`c ? f!: g` keeps the dammit) or a pair's.
export function tagVoidMarkers(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (ops.on) ops.n++;
    if (tokens[i].kind !== 'DAMMIT') continue;
    if (tokens[i + 1]?.kind === '=' ||
        (tokens[i - 1]?.kind === 'IDENTIFIER' && tokens[i - 2]?.kind === 'DEF')) {
      tokens[i].kind = 'VOID_MARKER';
    }
  }
  return tokens;
}


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
  'UNARY', 'RESERVED',
]);

const RUN_OPENERS = new Set(['(', 'CALL_START', 'PARAM_START', '[', 'INDEX_START', '{', 'PICK_START', 'OPTPICK_START']);
const RUN_CLOSERS = new Set([')', 'CALL_END', 'PARAM_END', ']', 'INDEX_END', '}', 'PICK_END']);

// Depth-0 enders of every type run. `=` ends a typed declaration's or
// typed default param's annotation — the reactive assign heads (`:=`,
// `~=`), the readonly head (`=!`), and the effect head (`~>`) end one
// the same way (`count: number := 0`, `x: number =! 5`,
// `h: Function ~> body`); `->` is the arrow
// operator (a function TYPE spells `=>`, which stops only in
// arrow-return position).
const RUN_STOPS = new Set(['TERMINATOR', 'INDENT', 'OUTDENT', ',', '=', 'COMPOUND_ASSIGN', 'REACTIVE_ASSIGN', 'COMPUTED_ASSIGN', 'READONLY_ASSIGN', 'EFFECT', '->']);

// Extra depth-0 stops for the cast's type run: the postfix cast lives
// inside a larger expression, so any binary/relational/ternary operator
// ends it (`|` and `&` are NOT stops — they are the union/intersection
// type operators, so `x as A | B` reads `x as (A | B)`, as in TS) —
// and so does any statement-clause keyword: a trailing clause never
// swallows into the type string, so `y = x as T if c` keeps its
// guard.
const CAST_STOPS = new Set([
  '+', '-', 'MATH', '**', 'SHIFT', 'COMPARE', '&&', '||', '??', '^',
  'RELATION', 'TERNARY', '?', 'PRESENCE', ':', '?.', 'DAMMIT', 'EXTENDS',
  'IF', 'UNLESS', 'ELSE', 'THEN', 'WHILE', 'UNTIL', 'LOOP', 'FOR',
  'WHEN', 'BY', 'SWITCH', 'RETURN', 'THROW',
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
// tokens, `typeof`, and block layout. Code-shaped tokens — calls
// (CALL_START), `new`, `await`, arithmetic/logical operators,
// assignments inside bodies — are NOT in the vocabulary and reject
// loudly.
const TYPE_VOCAB = new Set([
  'IDENTIFIER', 'PROPERTY', 'RESERVED', 'NUMBER', 'STRING', 'BOOL',
  'NULL', 'UNDEFINED',
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
  'NULL', 'UNDEFINED', ')', 'PARAM_END', ']', 'INDEX_END', '}',
]);
const assertTypeVocabulary = (tokens, from, to, fail, opts = {}) => {
  let angle = 0;
  let openAngle = null; // outermost unmatched '<'
  let atomEnd = false;  // the previous token completed a type atom
  let methodClose = -1; // index of the CALL_END closing an accepted method list
  const closeAngles = (t, n) => {
    angle -= n;
    if (angle < 0) {
      fail(`unbalanced '${t.value}' in a type body — the line is not a type`, t.start);
    }
    if (angle === 0) openAngle = null;
  };
  for (let j = from; j < to; j++) {
    if (ops.on) ops.n++;
    const t = tokens[j];
    const kd = t.kind;
    if (kd === 'COMPARE' && t.value === '<') {
      if (angle === 0) openAngle = t;
      angle++;
      atomEnd = false;
      continue;
    }
    if (kd === 'COMPARE' && t.value === '>') { closeAngles(t, 1); atomEnd = true; continue; }
    if (kd === 'SHIFT' && t.value === '>>') { closeAngles(t, 2); atomEnd = true; continue; }
    if (kd === 'SHIFT' && t.value === '>>>') { closeAngles(t, 3); atomEnd = true; continue; }
    if (kd === 'UNARY' && t.value === 'typeof') { atomEnd = false; continue; }
    // Optional-member marker: `name?: T` — the `?`
    // rides between a completed atom (the member name) and its `:`,
    // whatever kind the scanner gave it (PRESENCE/TERNARY). The same
    // shape covers optional params inside method shorthand
    // (`m(x?: number): void`). Any other `?` stays code-shaped.
    if (t.value === '?' && atomEnd && tokens[j + 1]?.kind === ':') { atomEnd = false; continue; }
    if (kd === '-' && tokens[j + 1]?.kind === 'NUMBER' && !atomEnd) { j++; atomEnd = true; continue; }
    if (kd === '=' && angle > 0) { atomEnd = false; continue; }
    if (opts.methods && kd === 'CALL_START' && methodClose === -1) {
      const name = tokens[j - 1];
      const memberStart = j - 2 < from ||
        tokens[j - 2].kind === 'TERMINATOR' || tokens[j - 2].kind === 'INDENT' || tokens[j - 2].kind === 'OUTDENT';
      if (name && (name.kind === 'IDENTIFIER' || name.kind === 'PROPERTY') && memberStart) {
        let d = 1;
        let k = j + 1;
        while (k < to && d > 0) {
          if (tokens[k].kind === 'CALL_START') d++;
          else if (tokens[k].kind === 'CALL_END') d--;
          k++;
        }
        if (d === 0 && tokens[k]?.kind === ':') {
          methodClose = k - 1;
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
    if (kd === 'CALL_END' && j === methodClose) { methodClose = -1; atomEnd = true; continue; }
    if (TYPE_VOCAB.has(kd)) { atomEnd = TYPE_ATOM_ENDERS.has(kd); continue; }
    fail(
      `code expression ('${t.value}') in a type body — types erase and cannot execute`,
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
const atStatementBoundary = (tokens, k) => {
  const t = tokens[k];
  if (!t) return true; // start of file
  if (t.kind === 'TERMINATOR' || t.kind === 'EXPORT') return true;
  if (t.kind !== 'INDENT' && t.kind !== 'OUTDENT') return false;
  // Walk back past balanced INDENT/OUTDENT pairs to the enclosing
  // block's INDENT and inspect its opener.
  let depth = 0;
  for (let j = k; j >= 0; j--) {
    if (ops.on) ops.n++;
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
    if (ops.on) ops.n++;
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
    if (ops.on) ops.n++;
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

    parts.push(t.value); end = t.end; j++;
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
    if (ops.on) ops.n++;
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
    if (ops.on) ops.n++;
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
    if (ops.on) ops.n++;
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
const beforeAngleGroupBack = (tokens, k) => {
  if (k < 0 || !tokens[k] || angleWeight(tokens[k]) >= 0) return k;
  let depth = 0;
  while (k >= 0) {
    if (ops.on) ops.n++;
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
const typeAliasEq = (tokens, eqIdx) => {
  let k = eqIdx - 1;
  if (tokens[k]?.kind === 'COMPARE' && tokens[k].value === '>') {
    let d = 1;
    k--;
    while (k >= 0 && d > 0) {
      if (ops.on) ops.n++;
      if (tokens[k].kind === 'COMPARE' && tokens[k].value === '>') d++;
      else if (tokens[k].kind === 'SHIFT' && tokens[k].value === '>>') d += 2;
      else if (tokens[k].kind === 'COMPARE' && tokens[k].value === '<') d--;
      k--;
    }
  }
  if (tokens[k]?.kind !== 'IDENTIFIER') return false;
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
      if (ops.on) ops.n++;
      from--;
    }
    memo.upTo = from + 1;
  }
  for (let j = memo.upTo; j < tokens.length; j++) {
    if (ops.on) ops.n++;
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
    }
  }
  memo.upTo = tokens.length;
  memo.ref = tokens[tokens.length - 1] ?? null;
};

const closesTypeGeneric = (tokens, inTypeBody, memo) => {
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
    if (ops.on) ops.n++;
    const kd = tokens[j].kind;
    if (RUN_OPENERS.has(kd)) depth++;
    else if (RUN_CLOSERS.has(kd)) {
      if (depth === 0) return -1;
      depth--;
    } else if (depth === 0) {
      if (kd === 'TERMINATOR' || kd === 'INDENT' || kd === 'OUTDENT' || kd === '->') return -1;
      if (kd === '=>') sawFatArrow = true;
      else if (kd === '=' || kd === 'REACTIVE_ASSIGN' || kd === 'COMPUTED_ASSIGN' || kd === 'READONLY_ASSIGN' || kd === 'EFFECT') {
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
    if (ops.on) ops.n++;
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
        if (ops.on) ops.n++;
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
    if (ops.on) ops.n++;
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
    if (ops.on) ops.n++;
    const kd = tokens[j].kind;
    if (RUN_OPENERS.has(kd)) depth++;
    else if (RUN_CLOSERS.has(kd)) {
      if (depth === 0) return -1;
      depth--;
    } else if (depth === 0) {
      if (kd === 'TERMINATOR') return j;
      if (kd === 'INDENT' || kd === 'OUTDENT' || kd === '=' || kd === 'COMPOUND_ASSIGN' ||
          kd === 'REACTIVE_ASSIGN' || kd === 'COMPUTED_ASSIGN' || kd === 'READONLY_ASSIGN' || kd === 'EFFECT') return -1;
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
    if (ops.on) ops.n++;
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
    if (ops.on) ops.n++;
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
  // the innermost indent is a class body.
  let pendingClassBody = false;
  const classIndents = [];
  const inClassBody = () => classIndents.length > 0 && classIndents[classIndents.length - 1];

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
      if (ops.on) ops.n++;
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
      if (ops.on) ops.n++;
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
        if (ops.on) ops.n++;
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
    if (ops.on) ops.n++;
    const tok = tokens[i];
    const kd = tok.kind;
    const prev = out[out.length - 1] ?? null;

    // ── `type Name = …` / `interface Name` — whole-statement type
    // declarations. The entire declaration collapses into ONE
    // TYPE_DECL token whose value is the raw source text (opaque to
    // the grammar; declaration emission — src/dts.js — structures
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
          if (prev.kind === 'PROPERTY') prev.kind = 'IDENTIFIER';
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
            } else if (prev.kind === 'PROPERTY') prev.kind = 'IDENTIFIER';
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
      if (frames.length === 0 && namedColon && typedDeclEq(tokens, i) >= 0) {
        const last = claim('TYPE', tok, i + 1, {});
        if (last >= 0) {
          if (nameTok.kind === 'PROPERTY' && !isAtName) nameTok.kind = 'IDENTIFIER';
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
          if (ops.on) ops.n++;
          const t2 = tokens[j].kind;
          if (RUN_OPENERS.has(t2)) depth++;
          else if (RUN_CLOSERS.has(t2)) {
            if (depth === 0) break;
            depth--;
          } else if (depth === 0) {
            if (t2 === 'TERMINATOR' || t2 === 'OUTDENT') { end = j; break; }
            if (t2 === 'INDENT' || t2 === '=' || t2 === 'COMPOUND_ASSIGN' ||
                t2 === 'REACTIVE_ASSIGN' || t2 === 'COMPUTED_ASSIGN' || t2 === 'READONLY_ASSIGN' || t2 === 'EFFECT') break;
          }
        }
        if (end > i + 1 && isCompleteTypeExpr(tokens, i + 1, end)) {
          const last = claim('TYPE', tok, i + 1, {});
          if (last >= 0) {
            if (nameTok.kind === 'PROPERTY' && !isAtName) nameTok.kind = 'IDENTIFIER';
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
            if (prev.kind === 'PROPERTY') prev.kind = 'IDENTIFIER';
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
    if (kd === 'CLASS' || kd === 'COMPONENT') pendingClassBody = true;
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
    if (ops.on) ops.n++;
    tokens[i] = out[i];
  }
  return tokens;
}

// Null-prototype lookup tables: these are indexed by USER identifier
// text, so an inherited Object.prototype member (`toString`,
// `constructor`, …) must never satisfy a lookup.
const KEYWORDS = {
  __proto__: null,
  def: 'DEF',
  if: 'IF',
  else: 'ELSE',
  return: 'RETURN',
  while: 'WHILE',
  until: 'UNTIL',
  true: 'BOOL',
  false: 'BOOL',
  null: 'NULL',
  undefined: 'UNDEFINED',
  this: 'THIS',
  unless: 'UNLESS',
  for: 'FOR',
  own: 'OWN',
  by: 'BY',
  switch: 'SWITCH',
  try: 'TRY',
  catch: 'CATCH',
  finally: 'FINALLY',
  throw: 'THROW',
  loop: 'LOOP',
  then: 'THEN',
  class: 'CLASS',
  extends: 'EXTENDS',
  super: 'SUPER',
  await: 'AWAIT',
  yield: 'YIELD',
  // `do` scans as DO (the invoke-an-expression operator); tagParams
  // retags it to DO_IIFE when a function literal follows.
  do: 'DO',
  enum: 'ENUM',
  // Components. `component` and `render` are keywords
  // everywhere (property/key positions capture first, so `x.render`
  // and `render: 1` stay legal); `offer`/`accept` are CONTEXT-
  // sensitive — keywords only lexically inside a component body
  // (classified by the scanner's backward walk, never listed here).
  component: 'COMPONENT',
  render: 'RENDER',
};

// Pure statements: the token value is the statement itself.
const STATEMENTS = new Set(['break', 'continue', 'debugger']);

// Keywords and JS reserved words with no feature behind them yet.
// They must never reach the parser as IDENTIFIER: with implicit calls
// live, `do f x` or `new Date` would otherwise compile silently to a
// CALL of a reserved word — invalid or wrong JS. Property positions
// (`a.new`, `new: 1`) stay legal. They scan as RESERVED
// tokens so a type-annotation run can absorb them (`(cb: () => void)`
// — TS types legitimately spell reserved words); any RESERVED token
// that survives rewriteTypes rejects loudly from its own position.
const RESERVED_WORDS = new Set([
  'default', // contextual: DEFAULT inside import/export lines only
  'function', 'var', 'let', 'const', 'void', 'with', 'case',
  'implements', 'interface', 'package',
  'private', 'protected', 'public', 'static', 'native',
]);

// Word aliases for operators: the token VALUE is the
// operator; the span covers the word.
const ALIASES = {
  __proto__: null,
  and: ['&&', '&&'],
  or: ['||', '||'],
  not: ['UNARY', '!'], // word-not is UNARY; symbol ! is UNARY_MATH
  new: ['UNARY', 'new'], // the emitter owns `new`'s lowering
  typeof: ['UNARY', 'typeof'],
  delete: ['UNARY', 'delete'],
  instanceof: ['RELATION', 'instanceof'],
  is: ['COMPARE', '=='],
  isnt: ['COMPARE', '!='],
  yes: ['BOOL', 'true'],
  no: ['BOOL', 'false'],
  on: ['BOOL', 'true'],
  off: ['BOOL', 'false'],
};

// Four- through two-character operators, longest match first ('...'
// range dots before '..'; '..' before '.'; '>>>' before '>>').
const OPS4 = { '>>>=': 'COMPOUND_ASSIGN' };
const OPS3 = {
  '**=': 'COMPOUND_ASSIGN', '&&=': 'COMPOUND_ASSIGN', '||=': 'COMPOUND_ASSIGN', '??=': 'COMPOUND_ASSIGN',
  '<<=': 'COMPOUND_ASSIGN', '>>=': 'COMPOUND_ASSIGN',
  '//=': 'COMPOUND_ASSIGN', '%%=': 'COMPOUND_ASSIGN',
  '>>>': 'SHIFT', '...': '...',
  // Two-way binding: `value <=> name` is one token, claimed
  // before OPS2's `<=' + `>` reading (which no legal program carries —
  // a tight `<=>` was a parse error before this claim). The token has
  // no grammar production: the render rewrite pass consumes it inside
  // render blocks; anywhere else it stays a loud parse rejection.
  '<=>': 'BIND',
};
const OPS2 = {
  '==': 'COMPARE', '!=': 'COMPARE', '<=': 'COMPARE', '>=': 'COMPARE',
  '**': '**', '&&': '&&', '||': '||', '??': '??', '..': '..',
  '+=': 'COMPOUND_ASSIGN', '-=': 'COMPOUND_ASSIGN', '*=': 'COMPOUND_ASSIGN',
  '/=': 'COMPOUND_ASSIGN', '%=': 'COMPOUND_ASSIGN',
  '&=': 'COMPOUND_ASSIGN', '^=': 'COMPOUND_ASSIGN', '|=': 'COMPOUND_ASSIGN',
  // Reactive declaration heads: `:=` (state) and `~=` (computed)
  // are single tokens, claimed before the bare ':' and '~' scanners.
  // Neither character pair has any other
  // reading (a bare `: =` or `~ =` run is a parse error), so the
  // claim can never change a program's meaning.
  ':=': 'REACTIVE_ASSIGN', '~=': 'COMPUTED_ASSIGN',
  // Readonly: ADJACENT `=!` is one token,
  // spacing around the pair free (`x =! 5`,
  // `x =!5`, `x=!5` all declare; only whitespace BETWEEN the two
  // characters yields assignment-of-negation, `x = !5`). `==` is
  // claimed by its own entry first, so `a ==!b` keeps its COMPARE +
  // negation reading; a post-name `!` scans DAMMIT before the `=`
  // is ever reached, so `save! = ->` (void marker) is untouched.
  '=!': 'READONLY_ASSIGN',
  '<<': 'SHIFT', '>>': 'SHIFT',
  // '//' floor division and '%%' true modulo are MATH like '*' and '%'.
  // A regex literal can never start '//' (REGEX_RE forbids it), so a
  // '//' that survives the regex scanner is always the operator;
  // '///' opens a heregex and is claimed before operator scanning.
  '//': 'MATH', '%%': 'MATH',
  // `~>` is the reactive effect head everywhere the main
  // grammar sees it; inside a schema body the same token spells a
  // computed getter (the schema sub-parser consumes it before
  // the grammar runs). `!>` (eager derived) exists only in schema
  // bodies — a stray one is a loud parse error. Both scan as single
  // tokens so a trailing one never reads as a line-continuing COMPARE.
  '~>': 'EFFECT', '!>': '!>',
  '->': '->', '=>': '=>', '++': '++', '--': '--', '?.': '?.',
  // Method assignment: ADJACENT `.=` is one token (`x .= trim()` —
  // the target re-binds to a method call on itself). No legal
  // program carries a tight `.` `=` pair (a property name must
  // follow `.`), so the claim can never change a program's meaning.
  '.=': 'METHOD_ASSIGN',
  // Merge assignment: ADJACENT `*>` is one token (`*>obj = {…}` —
  // the value merges into the target). No legal program carries a
  // tight `*` `>` pair (a comparison cannot follow a bare `*`), so
  // the claim can never change a program's meaning.
  '*>': 'MERGE_ASSIGN',
};

// Token kinds that leave the line UNFINISHED at a newline: the next line
// continues the same logical line (no TERMINATOR, no indent change).
// '??' continues like its operator family ('&&'/'||') — a multi-line
// nullish chain is one logical line. Deliberately excludes '=' —
// it continues through the grammar's dedicated `= TERMINATOR` /
// `= INDENT` rules instead.
const UNFINISHED = new Set([
  '.', '?.', 'UNARY', 'DO', 'DO_IIFE', 'MATH', 'UNARY_MATH', '+', '-', '**', 'SHIFT',
  'RELATION', 'COMPARE', '&', '^', '|', '&&', '||', '??', 'TERNARY', 'EXTENDS',
]);

// Token kinds after which '(' opens a call rather than a grouping.
// DAMMIT is callable: `f!(1, 2)` calls (and awaits) f. DYNAMIC_IMPORT
// exists only when a '(' or '!(' follows (the lexer mints it from that
// lookahead), so `import(url)` and `import!(url)` are real calls.
const CALLABLE = new Set(['IDENTIFIER', 'PROPERTY', ')', 'CALL_END', 'NUMBER', 'STRING', ']', 'INDEX_END', 'SUPER', 'DAMMIT', 'DYNAMIC_IMPORT']);

// Token kinds after which an unspaced '[' indexes rather than opening an
// array literal (the scan-time rule: !prev.spaced && INDEXABLE.has(prev)).
// THIS and '@' index (`this[k]`, `@[k]`); an INDEX pair that turns out to
// be a dynamic KEY retags to plain brackets in tagDynamicKeys.
const INDEXABLE = new Set([...CALLABLE, 'BOOL', 'NULL', 'UNDEFINED', '}', 'PICK_END', 'STRING_END', 'REGEX', 'HEREGEX_END', 'THIS', '@']);

// Identifier characters ([$\w\x7f-\uffff]):
// Unicode BMP letters and astral surrogate pairs are identifier text.
const IDENT_START = /[$A-Za-z_\x7f-\uffff]/;
const IDENT_PART = /[$\w\x7f-\uffff]/;
const DIGIT = /[0-9]/;

// The numeric-literal matcher: binary/octal/hex with optional
// BigInt suffix, decimal integers/floats with `_` separators and
// exponents — including leading-dot floats (`.5`, `.5e2`): the scanner
// dispatches on a digit OR a '.' directly followed by one, so a number
// is claimed before the '.' member operator or the range dots can be
// (`1..5` stays NUMBER '..' NUMBER — the two-dot run fails the guard).
const NUMBER_RE = /^0b[01](?:_?[01])*n?|^0o[0-7](?:_?[0-7])*n?|^0x[\da-f](?:_?[\da-f])*n?|^\d+(?:_\d+)*n|^(?:\d+(?:_\d+)*)?\.?\d+(?:_\d+)*(?:e[+-]?\d+(?:_\d+)*)?/i;

// The regex-literal matcher and division disambiguation sets.
const REGEX_RE = /^\/(?!\/)((?:[^[\/\n\\]|\\[^\n]|\[(?:\\[^\n]|[^\]\n\\])*\])*)(\/)?/;
const REGEX_FLAGS_RE = /^\w*/;
const VALID_FLAGS_RE = /^(?!.*(.).*\1)[gimsuy]*$/;
const NOT_REGEX = new Set([...INDEXABLE, '++', '--']);

export function tokenize(text, path = '<anonymous>') {
  // The RIP_COUNT_OPS flag re-reads per call (and resets the count) so
  // a COUNT-ratio gate measures exactly one tokenize run.
  syncOpsFlag();
  const source = new SourceFile(text, path);
  const tokens = [];
  const trivia = [];
  // Indentation is a LITERAL PREFIX, not a width: each entry is the
  // exact whitespace string opening that block. A nested block's prefix
  // must string-extend the enclosing block's; a dedent must return to
  // an exact open prefix. Pure-space files behave identically to a
  // width model (prefix length ≡ width); tab-only and consistently
  // mixed files nest by textual containment; inconsistent mixes —
  // including a tab and spaces that merely LOOK equal at some editor
  // tab width — reject loudly.
  const indents = [''];  // indentation-prefix stack
  // Open-bracket frames: {kind, depth} where kind is 'call' | 'group' |
  // 'index' | 'array' | 'object' | 'interp' and depth is the indent-stack
  // size at open — the frame's indentation FLOOR. Layout runs inside
  // brackets too (newlines separate elements; deeper lines open INDENT
  // blocks); a closer auto-closes any indent levels opened inside its
  // frame, and a dedent can never cross the innermost frame's floor.
  const parens = [];
  let pos = 0;
  let atLineStart = true;
  let lastNewlinePos = -1; // offset of the newline that ended the previous LOGICAL line
  let pendingSpaced = false;
  let pendingNewLine = false;
  // FOR seen on the current logical line, held as the bracket depth at
  // the FOR so the state survives newlines inside brackets opened after
  // it (`for x in [1,\n2]`); null = no pending FOR.
  let seenFor = null;
  // Module-statement scan state (seenImport/seenExport): the
  // contextual keywords `as`/`from`/`default` only tag inside an
  // import/export line — `from = 1` and `as = 2` stay identifiers. The
  // state survives line breaks inside brackets, so a multiline specifier
  // list still retags the `from` after its closing brace.
  let seenImport = false;
  let seenExport = false;
  // Render-block scan context: RENDER opens it; the first line
  // back at (or above) the render statement's own indent depth closes
  // it. Inside, a TIGHT `#word` is element-id syntax (spaced `# word`
  // stays a comment) and `.class-name` chains consume tight hyphens.
  let inRender = false;
  let renderDepth = 0;
  let nextId = 0; // stable token ids, creation order
  const pendingOrigin = []; // synthetic tokens awaiting the next real token's id

  // Rejections carry the bare reason plus the offset span as structured
  // fields — compile() formats them at the diagnostics boundary. The
  // message itself is pre-formatted so direct tokenize() callers see a
  // positioned error too.
  const fail = (message, at, end = at) => {
    const { line, col } = source.lineColAt(at);
    const err = new Error(`${path}:${line + 1}:${col + 1}: ${message}`);
    err.reason = message;
    err.start = at;
    err.end = end;
    throw err;
  };

  const push = (kind, value, start, end, extra = {}) => {
    // Lazy FROM tagging: `from` scans as an IDENTIFIER; the module
    // source STRING that follows retags it — so `from` stays a plain
    // identifier everywhere else (`from = 1`, `x = from + as`).
    if ((kind === 'STRING' || kind === 'STRING_START') && (seenImport || seenExport)) {
      const prevTok = tokens[tokens.length - 1];
      if (prevTok?.kind === 'IDENTIFIER' && prevTok.value === 'from') prevTok.kind = 'FROM';
    }
    // `yield from` — the delegation keyword pair: `from` right after
    // YIELD is the FROM token (contextual, like the module form).
    if (kind === 'IDENTIFIER' && value === 'from' && tokens[tokens.length - 1]?.kind === 'YIELD') {
      kind = 'FROM';
    }
    const token = {
      id: nextId++,
      kind, value, start, end,
      spaced: pendingSpaced,
      newLine: pendingNewLine,
      generated: false,
      origin: null,
      ...extra,
    };
    tokens.push(token);
    // Synthetic tokens' origin resolves to the ID of the first REAL
    // token that follows them — never to another synthetic token.
    if (!token.generated && pendingOrigin.length > 0) {
      for (const t of pendingOrigin) t.origin = token.id;
      pendingOrigin.length = 0;
    }
    pendingSpaced = false;
    pendingNewLine = false;
  };

  // Zero-width synthesized token; origin is patched to the ID of the
  // next real token when it is emitted (null when input ends first).
  const synth = (kind, at) => {
    const token = {
      id: nextId++,
      kind, value: kind, start: at, end: at,
      spaced: false, newLine: false, generated: true, origin: null,
    };
    pendingOrigin.push(token);
    tokens.push(token);
  };

  const last = () => tokens[tokens.length - 1] ?? null;

  // Context-sensitive `offer`/`accept`: keywords only
  // lexically inside a component body. The backward walk tracks net
  // block depth; an INDENT is on the word's ENCLOSING CHAIN exactly
  // when it takes the depth to a NEW MINIMUM (a sibling block closed
  // earlier in the walk raises depth first, so its own INDENT never
  // reaches a fresh minimum — an already-CLOSED component elsewhere in
  // the file can never poison later code). Each chain INDENT's header
  // line is scanned back to its line boundary for COMPONENT, so the
  // extends form (`… = component extends button` + INDENT) classifies
  // like the plain one.
  // Is the trailing `.`-chain a class SELECTOR chain — rooted at a
  // template tag or at a bare line-start dot? Walks the emitted
  // `.PROPERTY` pairs back to the chain root. Member chains (rooted
  // at `@`, a value, or a non-tag name) answer false, so hyphen
  // consumption never rewrites a value expression.
  const classSelectorChain = () => {
    let j = tokens.length - 1; // the '.' this word follows
    while (j >= 2 && tokens[j].kind === '.' && tokens[j - 1].kind === 'PROPERTY' && tokens[j - 2].kind === '.') j -= 2;
    const root = tokens[j - 1];
    if (!root || root.kind === 'INDENT' || root.kind === 'TERMINATOR' || root.kind === 'OUTDENT' || root.kind === 'RENDER') {
      return true; // bare `.cls-name` at a line start
    }
    return root.kind === 'IDENTIFIER' && TEMPLATE_TAGS.has(String(root.value).split('#')[0]);
  };

  const insideComponentBody = () => {
    let depth = 0;
    let min = 0;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const k = tokens[i].kind;
      if (k === 'OUTDENT') {
        depth++;
      } else if (k === 'INDENT') {
        depth--;
        if (depth < min) {
          min = depth;
          for (let j = i - 1; j >= 0; j--) {
            const h = tokens[j].kind;
            if (h === 'TERMINATOR' || h === 'INDENT' || h === 'OUTDENT') break;
            if (h === 'COMPONENT') return true;
          }
        }
      }
    }
    return false;
  };

  // Pick-key position, answered in O(1) from the open-bracket frame:
  // the innermost bracket is a tight-keyed pick body and the previous
  // token leaves the scanner at a key position — list start/
  // separator, a rename colon, or a layout boundary inside the body.
  // PROPERTY-tagged keys skip keyword classification, so
  // keyword-named keys (`user.{type, class}`) lex as plain key words
  // (the token-stream tests pin the kinds).
  const inPickKeyPos = () => {
    const frame = parens[parens.length - 1];
    if (!frame?.pickKeys) return false;
    const p = last()?.kind;
    return p === 'PICK_START' || p === 'OPTPICK_START' || p === ',' || p === ':' ||
      p === 'TERMINATOR' || p === 'INDENT' || p === 'OUTDENT';
  };

  // ── String scanning machinery ─────────────────────────────────────────

  // Scan raw content from pos to the closing delimiter (escape-aware).
  // Advances pos past the closer; returns the raw content text.
  const scanStringRaw = (delim, opener) => {
    const contentStart = pos;
    while (pos < text.length && !text.startsWith(delim, pos)) {
      if (delim.length === 1 && (text[pos] === '\n' || text[pos] === '\r')) fail('unterminated string', opener);
      if (text[pos] === '\\') pos++;
      pos++;
    }
    if (pos >= text.length) fail('unterminated string', opener);
    const content = text.slice(contentStart, pos);
    pos += delim.length;
    return content;
  };

  // Template-content escaping for backtick-delimited values: escape
  // unescaped backticks and ${ (existing backslash pairs pass through).
  const escapeTemplateContent = (s) =>
    s.replace(/\\[\s\S]|`|\$\{/g, (m) => (m[0] === '\\' ? m : `\\${m}`));

  // Heredoc indentation baseline. minIndent is the shallowest
  // indentation among lines that carry non-whitespace — the FIRST such
  // line fixes the initial candidate even when unindented, and only a
  // SHALLOWER indented line replaces it. The baseline is the closer's
  // own-line indentation when the closer sits alone on its line
  // (closerIndent non-null) and does not exceed minIndent; minIndent
  // otherwise (an inline closer contributes no column).
  const heredocMinIndent = (content) => {
    let minIndent = null;
    const indentRe = /\n+([^\S\n]*)(?=\S)/g;
    let m;
    while ((m = indentRe.exec(content))) {
      if (minIndent === null || (m[1].length > 0 && m[1].length < minIndent.length)) {
        minIndent = m[1];
      }
    }
    return minIndent;
  };

  const heredocBaseline = (minIndent, closerIndent) => {
    if (closerIndent === null) return minIndent ?? '';
    if (minIndent === null) return closerIndent;
    return closerIndent.length <= minIndent.length ? closerIndent : minIndent;
  };

  // Heredoc value processing: strip the baseline indentation after
  // every newline, drop a leading newline (content starting on the line
  // after the opener) and the trailing newline-plus-whitespace before
  // the closer. Content MAY start on the opener's own line — that first
  // line carries no indentation to strip. Line endings normalize to
  // '\n' in the VALUE only — spans stay raw-source offsets. Single-line
  // heredocs pass through.
  const heredocProcess = (content, delim) => {
    if (delim.length === 1) return content;
    content = content.replace(/\r\n?/g, '\n');
    if (!content.includes('\n')) return content;
    const closerLine = content.slice(content.lastIndexOf('\n') + 1);
    const closerIndent = /^[^\S\n]*$/.test(closerLine) ? closerLine : null;
    const baseline = heredocBaseline(heredocMinIndent(content), closerIndent);
    let s = baseline ? content.split(`\n${baseline}`).join('\n') : content;
    s = s.replace(/^\n/, '');
    return s.replace(/\n[^\S\n]*$/, '');
  };

  // Scan one double-quoted chunk from pos: ends at the closing delimiter
  // (final chunk → STRING or STRING_END) or at an unescaped `#{`
  // (interpolation opens; the main loop tokenizes the inside until the
  // matching `}` resumes the next chunk via the bracket stack).
  const scanDoubleChunk = (ctx) => {
    const chunkStart = pos;
    let hash = -1;
    while (pos < text.length && !text.startsWith(ctx.delim, pos)) {
      if (ctx.delim.length === 1 && (text[pos] === '\n' || text[pos] === '\r')) fail('unterminated string', ctx.opener);
      if (text[pos] === '\\') {
        pos += 2;
        continue;
      }
      // Both #{…} and ${…} interpolate in the double-quoted forms.
      if ((text[pos] === '#' || text[pos] === '$') && text[pos + 1] === '{') {
        hash = pos;
        break;
      }
      pos++;
    }
    if (pos >= text.length) fail('unterminated string', ctx.opener);

    const rawChunk = text.slice(chunkStart, hash === -1 ? pos : hash);
    if (hash === -1 && !ctx.started) {
      // Plain string/heredoc — one STRING token. Heredoc values are
      // backtick-delimited (a heredoc always emits as a template).
      const end = pos + ctx.delim.length;
      const processed = heredocProcess(rawChunk, ctx.delim);
      const value = ctx.delim.length === 3
        ? `\`${escapeTemplateContent(processed)}\``
        : `"${processed}"`;
      push('STRING', value, ctx.opener, end);
      pos = end;
      return;
    }
    if (!ctx.started) {
      ctx.started = true;
      push('STRING_START', '(', ctx.opener, ctx.opener + ctx.delim.length);
    }
    if (hash === -1) {
      // Final chunk + STRING_END; heredoc chunk values strip afterwards
      // (the closer's indentation is only known now).
      ctx.chunkIdx.push(tokens.length);
      push('STRING', `"${rawChunk}"`, chunkStart, pos);
      const end = pos + ctx.delim.length;
      push('STRING_END', ')', pos, end);
      pos = end;
      if (ctx.delim.length === 3) stripHeredocChunks(ctx);
      return;
    }
    ctx.chunkIdx.push(tokens.length);
    push('STRING', `"${rawChunk}"`, chunkStart, hash);
    push('INTERPOLATION_START', '(', hash, hash + 2);
    openBracket('interp', hash, { ctx });
    pos = hash + 2;
  };

  // Post-process a completed interpolated heredoc: strip the baseline
  // indentation from every chunk VALUE (spans stay raw), drop the
  // leading newline from the first chunk and the trailing newline-plus-
  // whitespace from the last. minIndent reads the concatenated chunk
  // text (the shallowest-content-line rule spans the interpolation
  // seams); the closer column reads the SOURCE line before the closer —
  // an interpolation there makes the closer inline even when the
  // chunk's own text is whitespace.
  const stripHeredocChunks = (ctx) => {
    const closer = tokens[tokens.length - 1];
    const closerLine = /([^\n]*)$/.exec(text.slice(0, closer.start).replace(/\r\n?/g, '\n'))[1];
    const closerIndent = /^[^\S\n]*$/.test(closerLine) ? closerLine : null;
    const values = ctx.chunkIdx.map((idx) => tokens[idx].value.slice(1, -1).replace(/\r\n?/g, '\n'));
    const baseline = heredocBaseline(heredocMinIndent(values.join('')), closerIndent);
    ctx.chunkIdx.forEach((idx, i) => {
      let v = values[i];
      if (baseline) v = v.split(`\n${baseline}`).join('\n');
      if (i === 0) v = v.replace(/^\n/, '');
      if (i === ctx.chunkIdx.length - 1) v = v.replace(/\n[^\S\n]*$/, '');
      tokens[idx].value = `"${v}"`;
    });
  };

  // ── Heregex scanning ───────────────────────────────────────────────
  // `///body///flags` — an extended regex whose body strips whitespace
  // and `#` comments at SCAN time (the value channel carries the
  // processed pattern; spans stay raw — the heredoc convention):
  //   - whitespace outside a character class drops; inside one it is
  //     pattern text and stays
  //   - a whitespace-preceded `#` (not `#{`) starts a comment running
  //     to end of line — a closer on that line is part of the comment,
  //     leaving the heregex unterminated (loud); a `#` with no leading
  //     whitespace is pattern text
  //   - `\` escapes pass through verbatim (`\ ` is a literal space)
  //   - an unescaped `/` escapes to `\/`; only `///` closes
  //   - `#{…}` interpolates (class state carries across chunks); the
  //     whole literal then lowers through the heregex node to a
  //     RegExp(…) call, chunks stripped by the same rules
  // A non-interpolated heregex is ONE REGEX token; an empty (or fully
  // stripped) body spells `(?:)` — a bare `//` would be a JS comment.
  // Flags validate on every form.

  // Scan one stripped chunk from pos; stops at `///` (close), `#{`
  // (interpolation), or end of input. Returns the processed text and
  // where interpolation begins (-1 otherwise).
  const scanHeregexChunk = (ctx) => {
    const chunkStart = pos;
    let out = '';
    let interpAt = -1;
    while (pos < text.length && !text.startsWith('///', pos)) {
      const c = text[pos];
      if (c === '\\') {
        if (pos + 1 >= text.length) break;
        out += text.slice(pos, pos + 2);
        pos += 2;
        continue;
      }
      if (c === '#' && text[pos + 1] === '{') {
        interpAt = pos;
        break;
      }
      if (ctx.inClass) {
        if (c === '\n' || c === '\r') {
          fail('newline inside a heregex character class (a regex literal cannot contain one)', pos);
        }
        if (c === ']') ctx.inClass = false;
        out += c;
        pos++;
        continue;
      }
      if (c === '[') {
        ctx.inClass = true;
        out += c;
        pos++;
        continue;
      }
      if (/\s/.test(c)) {
        while (pos < text.length && /\s/.test(text[pos])) pos++;
        if (text[pos] === '#' && text[pos + 1] !== '{') {
          while (pos < text.length && text[pos] !== '\n') pos++;
        }
        continue;
      }
      if (c === '/') {
        out += '\\/';
        pos++;
        continue;
      }
      out += c;
      pos++;
    }
    return { out, chunkStart, interpAt };
  };

  // Scan from the current chunk to the literal's close (or the next
  // interpolation, yielding to the main loop via the bracket stack).
  const scanHeregexPart = (ctx) => {
    const { out, chunkStart, interpAt } = scanHeregexChunk(ctx);
    if (interpAt >= 0) {
      if (!ctx.started) {
        ctx.started = true;
        push('HEREGEX_START', '///', ctx.opener, ctx.opener + 3);
      }
      push('STRING', `"${out}"`, chunkStart, interpAt);
      push('INTERPOLATION_START', '(', interpAt, interpAt + 2);
      openBracket('interp', interpAt, { ctx, heregex: true });
      pos = interpAt + 2;
      return;
    }
    if (!text.startsWith('///', pos)) fail('missing /// (unclosed heregex)', ctx.opener);
    const bodyEnd = pos;
    pos += 3;
    const flags = /^\w*/.exec(text.slice(pos))[0];
    if (!VALID_FLAGS_RE.test(flags)) fail(`invalid regular expression flags ${flags}`, pos);
    const end = pos + flags.length;
    if (!ctx.started) {
      push('REGEX', `/${out === '' ? '(?:)' : out}/${flags}`, ctx.opener, end);
    } else {
      push('STRING', `"${out}"`, chunkStart, bodyEnd);
      push('HEREGEX_END', flags, bodyEnd, end);
    }
    pos = end;
  };

  // End offset of the last REAL (non-generated) token — where a block's
  // content actually ends, past any trailing trivia.
  const lastRealEnd = () => {
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (!tokens[i].generated) return tokens[i].end;
    }
    return 0;
  };

  // ── Bracket frames ─────────────────────────────────────────────────────
  // Every open bracket records the indent-stack size at open (its
  // indentation floor). Its closer first DROPS any trailing statement
  // separator (a TERMINATOR directly before a closer separates nothing)
  // and then CLOSES any indent blocks opened inside the frame, so the
  // tape always reads `… content OUTDENT closer` — the shape the
  // INDENT-bearing list rules parse.
  // `at` is the opener's source offset — the position an unclosed-
  // bracket rejection points to (the interp sites pass the `#{`'s own
  // offset; the scan cursor has already moved past it there).
  const openBracket = (kind, at, extra = {}) => {
    parens.push({ kind, at, depth: indents.length, ...extra });
  };

  // Type-body floor: the indent-stack size at which a verified
  // `type … =` or `interface Name [extends N]` head opened its block
  // body (null when none is open). Every line at or beyond the floor
  // is TYPE TEXT — the O(1) answer closesTypeGeneric needs for
  // trailing generic closes, wrapped-across-lines generics included.
  // Cleared the moment indentation drops below the body.
  let typeBodyFloor = null;
  // The closesTypeGeneric incremental state for this run (one map
  // lookup per trailing-angle line; every token processed once).
  const typeGenericMemo = { upTo: 0, ref: null, level: 0, answers: new Map() };
  const insideTypeBody = () => typeBodyFloor !== null && indents.length >= typeBodyFloor;

  // On a `type Name =` alias head's own line, after the `=` — the other
  // scanner-known type position besides a type body.
  const aliasHeadOpen = () => {
    for (let j = tokens.length - 1; j >= 0; j--) {
      const kd = tokens[j].kind;
      if (kd === 'TERMINATOR' || kd === 'INDENT' || kd === 'OUTDENT') return false;
      if (kd === '=') return typeAliasEq(tokens, j);
    }
    return false;
  };
  const clearTypeBodyBelowFloor = () => {
    if (typeBodyFloor !== null && indents.length < typeBodyFloor) typeBodyFloor = null;
  };
  // Does the tape end with a type-body HEAD about to open its block —
  // `type Name [<params>] =`, or `interface Name [extends Name]` at a
  // statement boundary?
  const typeBodyHead = () => {
    const n = tokens.length;
    if (tokens[n - 1]?.kind === '=') return typeAliasEq(tokens, n - 1);
    const iface = (k) => tokens[k]?.kind === 'RESERVED' && tokens[k].value === 'interface';
    // A trailing balanced generic group rewinds to the name it hangs
    // off (`interface P<T>`, `… extends Q<T>`).
    const k = beforeAngleGroupBack(tokens, n - 1);
    if (k < 0 || tokens[k]?.kind !== 'IDENTIFIER') return false;
    if (iface(k - 1)) return atStatementBoundary(tokens, k - 2);
    if (tokens[k - 1]?.kind === 'EXTENDS') {
      const m = beforeAngleGroupBack(tokens, k - 2);
      if (m >= 0 && tokens[m]?.kind === 'IDENTIFIER' && iface(m - 1)) {
        return atStatementBoundary(tokens, m - 2);
      }
    }
    return false;
  };

  const closeBracket = () => {
    const frame = parens.pop();
    if (!frame) return null;
    while (tokens.length && tokens[tokens.length - 1].kind === 'TERMINATOR') tokens.pop();
    const blockEnd = lastRealEnd();
    while (indents.length > frame.depth) {
      indents.pop();
      synth('OUTDENT', blockEnd);
    }
    clearTypeBodyBelowFloor();
    return frame;
  };

  // Dedent to an exact open prefix, synthesizing OUTDENTs anchored at the
  // block's real content end. A dedent can never cross the innermost open
  // bracket's indentation floor — a closer must sit at or above the
  // indentation its bracket opened at.
  const dedentTo = (prefix, lineStart, hint = '') => {
    const blockEnd = lastRealEnd();
    const floor = parens.length > 0 ? parens[parens.length - 1].depth : 1;
    while (indents.length > 1 && indents[indents.length - 1].length > prefix.length) {
      if (indents.length <= floor) {
        fail(
          `dedent to ${JSON.stringify(prefix)} crosses the enclosing bracket's ` +
          `indentation floor ${JSON.stringify(indents[indents.length - 1])}`,
          lineStart,
        );
      }
      indents.pop();
      synth('OUTDENT', blockEnd);
    }
    clearTypeBodyBelowFloor();
    if (indents[indents.length - 1] !== prefix) {
      fail(
        `inconsistent indentation: ${JSON.stringify(prefix)} neither extends the ` +
        `enclosing block's ${JSON.stringify(indents[indents.length - 1])} nor matches any open block${hint}`,
        lineStart,
      );
    }
  };

  while (pos < text.length) {
    if (ops.on) ops.n++;
    // ── Logical line starts: read the indentation prefix, synthesize block tokens ──
    if (atLineStart) {
      const lineStart = pos;
      while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) pos++;
      const prefix = text.slice(lineStart, pos);

      // Blank line or comment-only line: trivia, no tokens, no indent
      // change. lastNewlinePos is untouched — it stays on the newline that
      // ended the previous LOGICAL line, which is the span the next
      // TERMINATOR must carry.
      if (pos >= text.length) break;
      const nlLen = text[pos] === '\n' ? 1 : (text[pos] === '\r' && text[pos + 1] === '\n' ? 2 : 0);
      if (nlLen) {
        trivia.push({ kind: 'blank', start: lineStart, end: pos + nlLen, text: text.slice(lineStart, pos + nlLen) });
        pos += nlLen;
        continue;
      }
      // In render blocks a TIGHT `#word` line is an element id
      // (`#main` → div#main), never a comment: fall through to
      // normal line handling so the indent machinery runs first. The
      // line must sit DEEPER than the render statement itself — a
      // shallower `#…` line has already left the block.
      const renderIdLine = inRender && /^#[A-Za-z_]/.test(text.slice(pos, pos + 2)) &&
        prefix.length > (indents[renderDepth - 1] ?? '').length;
      if (text[pos] === '#' && !renderIdLine) {
        let end = pos;
        while (end < text.length && text[end] !== '\n' && !(text[end] === '\r' && text[end + 1] === '\n')) end++;
        const withNl = end < text.length ? end + (text[end] === '\r' ? 2 : 1) : end;
        trivia.push({ kind: 'comment', start: pos, end, text: text.slice(pos, end) });
        if (end < text.length) {
          trivia.push({ kind: 'blank', start: end, end: withNl, text: text.slice(end, withNl) });
        }
        pos = withNl;
        continue;
      }

      // Line-continuation suppression: a trailing unfinished operator, or
      // a line starting with ',' or a member '.'/'?.', continues the
      // previous LOGICAL line — no TERMINATOR, no indent change. (`.5` is
      // a number and `..`/`...` are range dots, never continuers.)
      // EXCEPTION: a trailing '>' (or '>>'/'>>>') that closes a generic
      // in a return-type annotation ends its line — `def f(a): Map<K, V>`
      // must open its body block, not swallow it.
      const prev = last();
      const prevUnfinished = prev != null && UNFINISHED.has(prev.kind) && !closesTypeGeneric(tokens, insideTypeBody(), typeGenericMemo);
      const commaCont = text[pos] === ',';
      const dotAt = text[pos] === '?' && text[pos + 1] === '.' ? pos + 1 : (text[pos] === '.' ? pos : -1);
      // Inside render blocks a line-leading '.' is a NEW element
      // (`.card` — implicit-div class selector), never a member-chain
      // continuation.
      const dotCont = dotAt >= 0 && text[dotAt + 1] !== '.' && !DIGIT.test(text[dotAt + 1] ?? '') && !inRender;
      const current = indents[indents.length - 1];
      if (commaCont && !prevUnfinished && prefix.length < current.length) {
        // A comma at a LOWER indent continues the enclosing list: the
        // open blocks above it close, but no statement boundary appears
        // (`f 1, ->` + indented body + `, 2` keeps one argument list).
        dedentTo(prefix, lineStart, " — align the ',' with the statement it continues");
        atLineStart = false;
        pendingNewLine = true;
        continue;
      }
      if (prevUnfinished || commaCont || dotCont) {
        atLineStart = false;
        pendingNewLine = true;
        continue;
      }

      if (prefix !== current && prefix.startsWith(current)) {
        // A type-body head opening its block: everything at or beyond
        // this indent is type text (nested layout indents inherit
        // through the floor comparison).
        if (typeBodyFloor === null && typeBodyHead()) typeBodyFloor = indents.length + 1;
        indents.push(prefix);
        // Anchor at the first real token of the deeper line, not the line
        // start — a block's $self span begins at its content.
        synth('INDENT', pos);
      } else {
        if (prefix !== current) dedentTo(prefix, lineStart);
        // Same level (or just dedented): the newline separates statements —
        // except before continuation keywords, which extend the enclosing
        // statement (`else` → if, `catch`/`finally` → try), and never
        // doubled (a `;` may already have ended the statement).
        const continues = ['else', 'catch', 'finally'].some(
          (w) => text.startsWith(w, pos) && !IDENT_PART.test(text[pos + w.length] ?? ''),
        );
        if (tokens.length > 0 && lastNewlinePos >= 0 && !continues && last()?.kind !== 'TERMINATOR') {
          const nl = text[lastNewlinePos] === '\r' ? 2 : 1;
          push('TERMINATOR', text.slice(lastNewlinePos, lastNewlinePos + nl), lastNewlinePos, lastNewlinePos + nl, { generated: true });
        }
      }
      // A line back at (or above) the render statement's own depth
      // leaves the render block.
      if (inRender && indents.length <= renderDepth) inRender = false;
      atLineStart = false;
      pendingNewLine = true;
      if (seenFor !== null && parens.length <= seenFor) seenFor = null;
      if (parens.length === 0) {
        seenImport = false;
        seenExport = false;
      }
      continue;
    }

    const ch = text[pos];

    // ── Whitespace and line ends ──
    if (ch === ' ' || ch === '\t') {
      pendingSpaced = true;
      pos++;
      continue;
    }
    // A line ends at '\n' or at the two-character '\r\n' (one
    // terminator; spans cover both characters — offsets stay raw, the
    // input is never normalized). A bare '\r' is not a line ending.
    if (ch === '\r' && text[pos + 1] !== '\n') {
      fail('bare carriage return (not followed by a newline) is not supported', pos);
    }
    if (ch === '\n' || ch === '\r') {
      lastNewlinePos = pos;
      atLineStart = true;
      pos += ch === '\r' ? 2 : 1;
      continue;
    }

    // ── Comments (mid-line) ── In render blocks a TIGHT `#word` is
    // element-id syntax: it merges into an unspaced preceding
    // tag/class token (`div#main`, `.card#x`) or mints an implicit-div
    // id element at a child position (`#main` → div#main). A spaced
    // `# word` stays a comment.
    if (ch === '#') {
      if (inRender && /[A-Za-z_]/.test(text[pos + 1] ?? '')) {
        const m = /^#([A-Za-z_][\w-]*)/.exec(text.slice(pos));
        const prev = last();
        if (prev && (prev.kind === 'IDENTIFIER' || prev.kind === 'PROPERTY') && !pendingSpaced && !prev.generated) {
          prev.value += m[0];
          prev.end = pos + m[0].length;
          pos += m[0].length;
          continue;
        }
        if (prev && (prev.kind === 'TERMINATOR' || prev.kind === 'INDENT' || prev.kind === 'OUTDENT' || prev.kind === 'RENDER')) {
          push('IDENTIFIER', `div${m[0]}`, pos, pos + m[0].length);
          pos += m[0].length;
          continue;
        }
      }
      let end = pos;
      while (end < text.length && text[end] !== '\n' && !(text[end] === '\r' && text[end + 1] === '\n')) end++;
      trivia.push({ kind: 'comment', start: pos, end, text: text.slice(pos, end) });
      pos = end;
      continue;
    }

    // ── Identifiers, keywords, properties ──
    if (IDENT_START.test(ch)) {
      const start = pos;
      while (pos < text.length && IDENT_PART.test(text[pos])) pos++;
      const word = text.slice(start, pos);
      const prev = last();
      // A word directly followed by ':' is a property KEY before it is
      // anything else — keywords, aliases, and reserved words included
      // (key capture precedes keyword
      // classification: `when: 1` and `if: 2` are pairs). Ternary
      // branches are guarded; `::` and `:=` never key — the
      // prototype operator and the reactive assign own those colons.
      const keysColon = /^[^\S\n]*:(?![=:])/.test(text.slice(pos)) && prev?.kind !== 'TERNARY';
      if (prev && (prev.kind === '.' || prev.kind === '?.' || (prev.kind === '@' && !pendingSpaced))) {
        // Render blocks: a `.class-name` chain consumes tight hyphens
        // (`.counter-display` is ONE class name); never when
        // the run keys a pair, and ONLY on class-SELECTOR chains — a
        // chain rooted at a template tag (`div.counter-display`) or a
        // bare line-start dot (`.counter-display`). Member chains in
        // value positions keep the subtraction reading (`@box.w-pad`
        // is `this.box.value.w - pad`).
        let value = word;
        if (inRender && prev.kind === '.' && !keysColon && classSelectorChain()) {
          while (text[pos] === '-' && IDENT_START.test(text[pos + 1] ?? '')) {
            let j = pos + 1;
            while (j < text.length && IDENT_PART.test(text[j])) j++;
            value += text.slice(pos, j);
            pos = j;
          }
        }
        push('PROPERTY', value, start, pos);
      } else if (keysColon || inPickKeyPos()) {
        push('PROPERTY', word, start, pos);
      } else if (word === 'import') {
        // `import(` / `import!(` is the dynamic-import CALL and
        // `import.` heads the import.meta member — neither opens a
        // module statement; everything else is the IMPORT keyword.
        if (text[pos] === '(' || (text[pos] === '!' && text[pos + 1] === '(')) {
          push('DYNAMIC_IMPORT', word, start, pos);
        } else if (text[pos] === '.') {
          push('IMPORT_META', word, start, pos);
        } else {
          seenImport = true;
          push('IMPORT', word, start, pos);
        }
      } else if (word === 'export') {
        seenExport = true;
        push('EXPORT', word, start, pos);
      } else if (word === 'as' && seenFor !== null) {
        // After FOR on the same logical line, `as` is the iterator-
        // protocol connector (`for x as iterable`); `as!` is its
        // async-iteration shorthand. The token value is `as` either
        // way; the `!` extends the span.
        if (text[pos] === '!') {
          pos++;
          push('FORASAWAIT', 'as', start, pos);
        } else {
          push('FORAS', word, start, pos);
        }
        seenFor = null;
      } else if (word === 'as' && (seenImport || seenExport) &&
                 (prev?.kind === 'DEFAULT' || prev?.kind === 'IMPORT_ALL' || prev?.kind === 'IDENTIFIER')) {
        // Contextual: only inside a module line, after a specifier
        // — `as = 2` elsewhere stays an identifier.
        push('AS', word, start, pos);
      } else if (word === 'default' && (seenImport || seenExport) &&
                 (prev?.kind === 'EXPORT' || prev?.kind === 'AS' || prev?.kind === '{' || prev?.kind === ',')) {
        // Contextual: `export default …`, `{default as d}`, `a as
        // default` — reserved everywhere else.
        push('DEFAULT', word, start, pos);
      } else if (word === 'when') {
        // `when` at a logical-line start belongs to a switch arm
        // (the newLine position decides at scan time).
        push(pendingNewLine ? 'LEADING_WHEN' : 'WHEN', word, start, pos);
      } else if (word === 'in' || word === 'of') {
        // After FOR on the same logical line, `in`/`of` are the for-loop
        // connectors (the seenFor scan state); elsewhere they are the
        // RELATION operators.
        if (seenFor !== null) {
          push(word === 'in' ? 'FORIN' : 'FOROF', word, start, pos);
          seenFor = null;
        } else {
          push('RELATION', word, start, pos);
        }
      } else if (word === 'for') {
        seenFor = parens.length;
        push('FOR', word, start, pos);
      } else if (STATEMENTS.has(word)) {
        push('STATEMENT', word, start, pos);
      } else if (ALIASES[word]) {
        const [kind, value] = ALIASES[word];
        // Word compound assignments: `and=` / `or=` are COMPOUND_ASSIGN
        // with the operator value, span covering word + '='.
        if ((word === 'and' || word === 'or') && text[pos] === '=' && text[pos + 1] !== '=') {
          pos++;
          push('COMPOUND_ASSIGN', `${value}=`, start, pos);
        } else {
          push(kind, value, start, pos);
        }
      } else if ((word === 'offer' || word === 'accept') && insideComponentBody()) {
        push(word === 'offer' ? 'OFFER' : 'ACCEPT', word, start, pos);
      } else if (KEYWORDS[word]) {
        push(KEYWORDS[word], word, start, pos);
        if (KEYWORDS[word] === 'RENDER') {
          inRender = true;
          renderDepth = indents.length;
        }
      } else if (RESERVED_WORDS.has(word)) {
        push('RESERVED', word, start, pos);
      } else {
        push('IDENTIFIER', word, start, pos);
      }
      continue;
    }

    // ── Numbers: radix prefixes, BigInt, separators, exponents,
    // leading-dot floats — with radix-prefix validation ──
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[pos + 1] ?? ''))) {
      const m = NUMBER_RE.exec(text.slice(pos));
      const number = m[0];
      if (/^0[BOX]/.test(number)) fail(`radix prefix in '${number}' must be lowercase`, pos + 1);
      if (/^0\d*[89]/.test(number)) fail(`decimal literal '${number}' must not be prefixed with '0'`, pos);
      if (/^0\d+/.test(number)) fail(`octal literal '${number}' must be prefixed with '0o'`, pos);
      push('NUMBER', number, pos, pos + number.length);
      pos += number.length;
      continue;
    }

    // ── Strings and heredocs ──
    // Double-quoted forms interpolate: their token stream is
    // STRING_START, STRING chunks alternating with fully tokenized
    // INTERPOLATION_START … INTERPOLATION_END sub-streams, STRING_END —
    // every token carrying REAL source spans. The scan is recursive by
    // construction: `#{` pushes an interpolation frame on the bracket
    // stack and yields to the main loop; the matching `}` resumes chunk
    // scanning. Heredoc values strip the closing delimiter's line
    // indentation from every line, drop the newline after
    // the opener and the one before the closer; spans stay raw.
    if (ch === '"' || ch === "'") {
      const delim = text.startsWith(ch.repeat(3), pos) ? ch.repeat(3) : ch;
      const start = pos;
      pos += delim.length;
      if (delim[0] === "'") {
        // Single-quote family: never interpolates. Heredoc values are
        // backtick-delimited (the delimiter kind lives in the value's
        // own delimiters — no metadata channel); plain values normalize to
        // double-quoted form (unescape ', escape ").
        const raw = scanStringRaw(delim, start);
        const processed = heredocProcess(raw, delim).replace(/\\'/g, "'");
        const value = delim.length === 3
          ? `\`${escapeTemplateContent(processed)}\``
          : `"${processed.replace(/"/g, '\\"')}"`;
        push('STRING', value, start, pos);
      } else {
        scanDoubleChunk({ delim, opener: start, started: false, chunkIdx: [] });
      }
      continue;
    }

    // ── Regex literals ──
    if (ch === '/') {
      // `///` always opens a heregex — no division context applies
      // (before operator scanning, which would read `//` as MATH).
      if (text.startsWith('///', pos)) {
        const opener = pos;
        pos += 3;
        scanHeregexPart({ opener, inClass: false, started: false });
        continue;
      }
      const m = REGEX_RE.exec(text.slice(pos));
      if (m) {
        const prev = last();
        const closed = m[2];
        let division = false;
        if (prev && !prev.generated) {
          if (pendingSpaced && CALLABLE.has(prev.kind) && (!closed || /^\/=?\s/.test(m[0]))) division = true;
          else if (NOT_REGEX.has(prev.kind) && !(pendingSpaced && CALLABLE.has(prev.kind))) division = true;
        }
        if (!division) {
          if (!closed) fail('missing / (unclosed regex)', pos);
          // `#{` inside a slash regex is NOT interpolation (the
          // heregex form owns that); leaving it as literal pattern
          // characters silently matches the wrong thing, so it
          // rejects with both spellings named.
          const interp = /(^|[^\\])(\\\\)*#\{/.exec(m[1]);
          if (interp) {
            const at = pos + 1 + interp.index + interp[0].length - 2;
            fail("a slash regex does not interpolate — use the heregex form (///…#{…}…///), or escape a literal match as \\#\\{", at, at + 2);
          }
          const flags = REGEX_FLAGS_RE.exec(text.slice(pos + m[0].length))[0];
          if (!VALID_FLAGS_RE.test(flags)) fail(`invalid regular expression flags ${flags}`, pos);
          const end = pos + m[0].length + flags.length;
          push('REGEX', `/${m[1]}/${flags}`, pos, end);
          pos = end;
          continue;
        }
      }
      // Division (or /=) — falls through to the operator scanners.
    }

    // ── Operators and punctuation (longest match first) ──
    const four = text.slice(pos, pos + 4);
    if (OPS4[four]) {
      push(OPS4[four], four, pos, pos + 4);
      pos += 4;
      continue;
    }
    const three = text.slice(pos, pos + 3);
    if (OPS3[three]) {
      push(OPS3[three], three, pos, pos + 3);
      pos += 3;
      continue;
    }
    const two = text.slice(pos, pos + 2);
    if (OPS2[two]) {
      // Unspaced `!=` directly after a name is the bang sigil
      // colliding with an assignment (`f!= 1`) — rejected; a spaced
      // `a != b` is the comparison as usual.
      if (two === '!=' && !pendingSpaced && (last()?.kind === 'IDENTIFIER' || last()?.kind === 'PROPERTY')) {
        fail(`cannot use the '!' sigil in an assignment to '${last().value}' (write 'a != b' with a space for comparison)`, pos);
      }
      push(OPS2[two], two, pos, pos + 2);
      pos += 2;
      continue;
    }
    if (ch === '<' || ch === '>') {
      push('COMPARE', ch, pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === '*' || ch === '/' || ch === '%') {
      // A namespace/re-export star in specifier position (`import * as
      // ns`, `import d, * as ns`, `export * from`).
      if (ch === '*' && seenImport && (last()?.kind === 'IMPORT' || last()?.kind === ',')) push('IMPORT_ALL', ch, pos, pos + 1);
      else if (ch === '*' && last()?.kind === 'EXPORT') push('EXPORT_ALL', ch, pos, pos + 1);
      else push('MATH', ch, pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === '!' || ch === '~') {
      // The dammit operator: an unspaced `!` directly after a name is
      // call-plus-await sugar (`fetchUsers!` → `await fetchUsers()`,
      // `obj.method!`) — a real token, resolved by the grammar into a
      // real node.
      if (ch === '!' && !pendingSpaced && (last()?.kind === 'IDENTIFIER' || last()?.kind === 'PROPERTY' || last()?.kind === 'DYNAMIC_IMPORT')) {
        push('DAMMIT', '!', pos, pos + 1);
        pos++;
        continue;
      }
      push('UNARY_MATH', ch, pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === '&' || ch === '|' || ch === '^') {
      push(ch, ch, pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === '?') {
      // Spaced '?' is the ternary operator. Unspaced: '?(' and '?['
      // are the optional call/index (the dotless '?.' spelling), '?!'
      // directly after a value-ending token is the postfix presence
      // check (`a?!` → `a ? true : undefined` — the Houdini operator),
      // and a '?' directly after a value-ending token is the postfix
      // existence check (`a?` → `a != null`) — real tokens and nodes.
      if (!pendingSpaced) {
        if (text[pos + 1] === '(' || text[pos + 1] === '[') {
          push('?.', '?', pos, pos + 1);
          pos++;
          continue;
        }
        const prev = last();
        if (text[pos + 1] === '!' && prev && !prev.generated && INDEXABLE.has(prev.kind)) {
          push('PRESENCE', '?!', pos, pos + 2);
          pos += 2;
          continue;
        }
        if (prev && !prev.generated && INDEXABLE.has(prev.kind)) {
          // The optional-declaration MARKER: a tight '?' on a
          // name whose line continues with a member-declaration
          // operator (`:=`, `~=`, `=!`, or plain `=` — never `==`/
          // `=>`) marks the declaration optional (`@name? := "anon"`,
          // `@name? =! 1`). A distinct token, so the postfix existence
          // check keeps its own grammar untouched (the marker is
          // meaningful only to the component member model — elsewhere
          // it records and the lowering ignores it).
          // A `:` continuation admits a TYPE annotation between the
          // marker and the operator (`@name?: string := v` — the
          // rewriteTypes claims see through the marker); `::` stays
          // out (the prototype operator owns the colon pair).
          // The NAME must sit at a member/statement position
          // (after `@` or a line boundary) — a `b?: string` inside a
          // type's object literal is TYPE TEXT, never a marker.
          const beforeName = tokens[tokens.length - 2] ?? null;
          const nameSlot = beforeName === null || beforeName.kind === '@' ||
            beforeName.kind === 'TERMINATOR' || beforeName.kind === 'INDENT' || beforeName.kind === 'OUTDENT';
          if ((prev.kind === 'PROPERTY' || prev.kind === 'IDENTIFIER') && nameSlot &&
              /^[^\S\n]*(:=|~=|=!|=(?![=>!])|:(?![:=]))/.test(text.slice(pos + 1))) {
            push('OPT_MARKER', '?', pos, pos + 1);
            pos++;
            continue;
          }
          push('?', '?', pos, pos + 1);
          pos++;
          continue;
        }
        fail("unspaced '?' needs a value before it (postfix existence) — write ' ? ' for a ternary", pos);
      }
      push('TERNARY', '?', pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === '@') {
      push('@', '@', pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === '(') {
      const prev = last();
      // Optional call: an unspaced '(' directly after '?.' retags it to
      // ES6_OPTIONAL_CALL and opens a real call.
      if (prev && !pendingSpaced && prev.kind === '?.') {
        prev.kind = 'ES6_OPTIONAL_CALL';
        openBracket('call', pos);
        push('CALL_START', '(', pos, pos + 1);
        pos++;
        continue;
      }
      const isCall = prev && !pendingSpaced && !prev.generated && CALLABLE.has(prev.kind);
      openBracket(isCall ? 'call' : 'group', pos);
      push(isCall ? 'CALL_START' : '(', '(', pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === ')') {
      const open = closeBracket();
      if (open?.kind !== 'call' && open?.kind !== 'group') fail("unmatched ')'", pos);
      push(open.kind === 'call' ? 'CALL_END' : ')', ')', pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === '[') {
      const prev = last();
      // Optional index: an unspaced '[' directly after '?.' retags it to
      // ES6_OPTIONAL_INDEX and opens a real index.
      if (prev && !pendingSpaced && prev.kind === '?.') {
        prev.kind = 'ES6_OPTIONAL_INDEX';
        openBracket('index', pos);
        push('INDEX_START', '[', pos, pos + 1);
        pos++;
        continue;
      }
      const isIndex = prev && !pendingSpaced && !prev.generated && INDEXABLE.has(prev.kind);
      openBracket(isIndex ? 'index' : 'array', pos);
      push(isIndex ? 'INDEX_START' : '[', '[', pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === ']') {
      const open = closeBracket();
      if (open?.kind !== 'index' && open?.kind !== 'array') fail("unmatched ']'", pos);
      push(open.kind === 'index' ? 'INDEX_END' : ']', ']', pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === '{') {
      // A pick operator's brace: a tight `.`/`?.` after an INDEXABLE
      // token (a PICK_END receiver stays a member dot — chained picks
      // reject at parse). The whole retag happens at the brackets: the
      // dot pops off the tape here, this brace scans as
      // PICK_START/OPTPICK_START, and the matching `}` reads its
      // PICK_END identity from THIS frame in O(1) — no matching walk
      // exists (a per-pick forward rescan is quadratic exactly on
      // nested picks; the count gate pins the shape). `pickKeys`
      // carries the key-tagging spacing rule: keys lex as PROPERTY
      // only when the brace also sits TIGHT against its first key
      // (`o.{a}` — PROPERTY; `o.{ a }` — IDENTIFIER; both parse, the
      // token-stream tests pin the kinds).
      const dot = last();
      const isPick = dot != null && (dot.kind === '.' || dot.kind === '?.') &&
        !pendingSpaced && !dot.newLine &&
        tokens.length >= 2 && INDEXABLE.has(tokens[tokens.length - 2].kind) &&
        tokens[tokens.length - 2].kind !== 'PICK_END';
      if (isPick) {
        tokens.pop();
        openBracket('object', pos, { pick: true, pickKeys: text[pos + 1] !== ' ' && text[pos + 1] !== '\t' });
        push(dot.kind === '?.' ? 'OPTPICK_START' : 'PICK_START', '{', pos, pos + 1);
      } else {
        openBracket('object', pos);
        push('{', '{', pos, pos + 1);
      }
      pos++;
      continue;
    }
    if (ch === '}') {
      const open = closeBracket();
      if (open?.kind === 'interp') {
        // Close of an interpolated expression: resume chunk scanning
        // in the enclosing literal (string or heregex).
        push('INTERPOLATION_END', ')', pos, pos + 1);
        pos++;
        if (open.heregex) scanHeregexPart(open.ctx);
        else scanDoubleChunk(open.ctx);
        continue;
      }
      if (open?.kind !== 'object') fail("unmatched '}'", pos);
      push(open.pick ? 'PICK_END' : '}', '}', pos, pos + 1);
      pos++;
      continue;
    }
    // `::` — prototype access when an identifier character follows
    // immediately (`A::m` reads as `A.prototype.m`): three minted
    // tokens all spanning the two `::` bytes, so mapping rows over the
    // expansion classify as honest covers (emitted `.prototype.` never
    // matches the source bytes). A tight existence token ahead makes
    // it the SOAK form (`a?::b` reads as `a?.prototype.b`): the `?`
    // retags to the optional-member link and widens over the `::`
    // bytes. Any other doubled colon is a type-spelling mistake and
    // rejects with the fix; in the scanner-known type positions (a
    // type body, an alias RHS) the prototype reading never applies,
    // so `::` rejects there too.
    if (ch === ':' && text[pos + 1] === ':') {
      if (!insideTypeBody() && !aliasHeadOpen() && IDENT_START.test(text[pos + 2] ?? '')) {
        const prev = tokens[tokens.length - 1];
        if (prev?.kind === '?' && prev.end === pos) {
          prev.kind = '?.';
          prev.value = '?.';
          prev.end = pos + 2;
          push('PROPERTY', 'prototype', pos, pos + 2);
          push('.', '.', pos, pos + 2);
        } else {
          push('.', '.', pos, pos + 2);
          push('PROPERTY', 'prototype', pos, pos + 2);
          push('.', '.', pos, pos + 2);
        }
        pos += 2;
        continue;
      }
      fail("type annotations use a single ':' (e.g. `x: number`), not '::'", pos, pos + 2);
    }
    if (ch === '=' || ch === '+' || ch === '-' || ch === '.' || ch === ',' || ch === ';' || ch === ':') {
      push(ch === ';' ? 'TERMINATOR' : ch, ch, pos, pos + 1);
      pos++;
      continue;
    }

    // A backtick in a TYPE position is a template-literal type — a TS
    // form Rip's structured types do not carry; the rejection names
    // the construct instead of surfacing the raw scanner error. Type
    // positions are the scanner-known ones: inside a type-body block,
    // or on a `type Name =` alias head's own line.
    if (ch === '`') {
      if (insideTypeBody() || aliasHeadOpen()) {
        fail("template-literal types are not supported — a Rip type cannot contain '`'", pos);
      }
    }

    fail(`cannot tokenize '${ch}'`, pos);
  }

  // Unclosed brackets reject at the OUTERMOST unclosed opener — the
  // FIRST opener in source order that never finds its closer (every
  // frame still open at EOF nests inside it) — with the opener's own
  // glyph and span, so the caret lands on the bracket to fix, not at
  // end of input.
  if (parens.length > 0) {
    const open = parens[0];
    const glyph = { call: '(', group: '(', index: '[', array: '[', object: '{', interp: '#{' }[open.kind] ?? open.kind;
    fail(`unclosed '${glyph}' — never closed by end of input`, open.at, open.at + glyph.length);
  }

  // Close any open blocks at end of input, anchored at the end of the
  // last real content (trailing newlines/trivia never extend spans).
  const eofEnd = lastRealEnd();
  while (indents.length > 1) {
    indents.pop();
    synth('OUTDENT', eofEnd);
  }

  // Post-scan passes: scan → tagParams → tagDynamicKeys →
  // rewriteTypes → implicitBlocks → tagPostfixConditionals →
  // implicitObjects → implicitCalls → tape. Order matters:
  // parameter retagging reads pre-insertion arrow context; implicit
  // INDENTs must exist before postfix detection (a then-body if is a
  // PREFIX if); postfix retagging must precede implicit calls so `f if
  // x` guards f instead of calling it.
  const mintId = () => nextId++;
  tagParams(tokens);
  tagDynamicKeys(tokens);
  // Definition-site bangs resolve BEFORE rewriteTypes (its def-context
  // scans read VOID_MARKER); the object/class-key form resolves later,
  // inside implicitObjects, where ternary context is known.
  tagVoidMarkers(tokens);
  // Types collapse BEFORE the implicit-structure passes:
  // a claimed annotation colon can no longer open an implicit object,
  // and a claimed `as` can no longer head an implicit call. Runs after
  // tagParams — param and arrow-return contexts read PARAM_START/END.
  // Schema declarations collapse BEFORE types: a schema body's `~>`
  // spellings and keyword-named fields are schema grammar, not type
  // syntax, so rewriteTypes must never see them. Typed callable
  // params inside captured bodies still collapse — the emit-time
  // sub-parse runs rewriteTypes as its first tail pass.
  rewriteSchema(tokens, mintId, text, fail);
  rewriteTypes(tokens, mintId, text, fail);
  // Reserved words are legal inside type runs (absorbed above); one
  // surviving in VALUE position is the original loud rejection.
  for (const t of tokens) {
    if (t.kind === 'RESERVED') {
      fail(`'${t.value}' is reserved and not supported yet`, t.start);
    }
  }
  // Render blocks rewrite BEFORE the implicit-structure passes: every
  // INDENT the pass sees is a real scanner block (never a synthesized
  // single-liner wrapper), and the tokens it injects (CALL_START,
  // arrows, pairs) participate in implicitObjects/implicitCalls like
  // user-written ones.
  rewriteRender(tokens, mintId, fail);
  applyInsertionPass(tokens, implicitBlocks, mintId);
  tagPostfixConditionals(tokens);
  applyInsertionPass(tokens, implicitObjects, mintId);
  applyInsertionPass(tokens, implicitCalls, mintId);

  return { tokens, trivia, source };
}

// The insertion-pass runner — the ONE place the pipeline mutates the
// tape's structure. Insertion passes are COLLECTORS: they walk the
// tape read-only (structurally — retagging kinds in place is the
// retag-pass privilege they may also use), returning `{at, token}`
// pairs against ORIGINAL indices (non-decreasing `at`, the natural
// product of a left-to-right walk; equal-`at` entries keep record
// order). The runner applies the whole list in one backward merge —
// O(tape + insertions), in place. The merge is module-private and the
// collector's `{at, token}` records refer to ORIGINAL indices, so an
// in-pass `splice` (O(tape) EACH — quadratic for a pass with O(n)
// insertions) is incoherent with the signature: any mid-walk mutation
// would invalidate every subsequent `at` this runner applies.
export function applyInsertionPass(tokens, pass, mintId) {
  const insertions = pass(tokens, mintId);
  if (insertions.length === 0) return tokens;
  let read = tokens.length - 1;
  let ins = insertions.length - 1;
  tokens.length += insertions.length;
  for (let write = tokens.length - 1; write >= 0; write--) {
    if (ops.on) ops.n++;
    if (ins >= 0 && (read < 0 || insertions[ins].at > read)) {
      tokens[write] = insertions[ins--].token;
    } else {
      tokens[write] = tokens[read--];
    }
  }
  return tokens;
}

// Implicit-block insertion (single-liner normalization) — the
// pipeline's first INSERTION pass, extending the insertion-pass contract: an
// insertion pass mints fresh ids (continuing the tape's sequence),
// records generated zero-width tokens anchored inside the construct (INDENT at the
// first real body token, OUTDENT at the last real body token's end),
// and sets origin to the ID of the anchoring real token. Ids are the
// stable identity — indices are never stored, so insertion invalidates
// nothing.
//
// Triggers:
//   - an arrow not followed by INDENT wraps its single-line body
//   - THEN retags to the block's INDENT
//   - ELSE followed by neither INDENT nor IF wraps its single-line body
// A body ends at the first depth-0 TERMINATOR, OUTDENT, ELSE, or
// enclosing closer; brackets and INDENT/OUTDENT pairs track depth.
// Wrapped bodies are OPEN blocks on a pending stack while the walk is
// inside them; each block's OUTDENT is recorded when the walk reaches
// its end index. Nesting holds by construction — an inner body's end
// never passes an enclosing pending end (the inner scan meets the same
// depth-0 stop at greater-or-equal depth and fewer unclaimed inline
// IFs) — so pops are innermost-first, which is exactly the token
// order the tape needs at a shared boundary.
export function implicitBlocks(tokens, mintId) {
  const OPENERS = new Set(['(', '[', '{', 'PICK_START', 'OPTPICK_START', 'CALL_START', 'INDEX_START', 'PARAM_START', 'STRING_START', 'INTERPOLATION_START', 'HEREGEX_START']);
  const CLOSERS = new Set([')', ']', '}', 'PICK_END', 'CALL_END', 'INDEX_END', 'PARAM_END', 'STRING_END', 'INTERPOLATION_END', 'HEREGEX_END']);
  const insertions = []; // {at, token} against original indices
  const pending = []; // open generated blocks: {end, closeAt, afterId}

  // A depth-0 comma inside the body belongs to an implicit CALL or
  // OBJECT opened WITHIN the body — the argument/property list owns it
  // and the body extends past it. The scan walks the original tape,
  // bounded at the body's START
  // index — the one cross-pass import here is the call pass's start
  // predicate (spaced IMPLICIT_FUNC + call starter), evaluated on the
  // pre-insertion tape (implicitBlocks runs before
  // implicitObjects/implicitCalls, so those passes' frames do not
  // exist yet).
  const commaInImplicitCall = (start, i) => {
    let levels = 0;
    for (let j = i - 1; j >= start; j--) {
      if (ops.on) ops.n++;
      const k = tokens[j].kind;
      if (CLOSERS.has(k) || k === 'OUTDENT') { levels++; continue; }
      if (OPENERS.has(k) || k === 'INDENT') {
        if (k === 'INDENT') return false;
        levels--;
        if (levels < 0) return false;
        continue;
      }
      if (levels > 0) continue;
      if (startsImplicitCall(tokens, j)) return true;
    }
    return false;
  };

  const commaInImplicitObject = (start, i) => {
    let levels = 0;
    for (let j = i - 1; j >= start; j--) {
      if (ops.on) ops.n++;
      const k = tokens[j].kind;
      if (CLOSERS.has(k) || k === 'OUTDENT') { levels++; continue; }
      if (OPENERS.has(k) || k === 'INDENT') {
        levels--;
        if (levels < 0) return false;
        continue;
      }
      if (levels > 0) continue;
      if (k === ':' && tokens[j - 1]?.kind === 'PROPERTY') return looksObjectishAt(tokens, i + 1);
      if (k === 'TERMINATOR') return false;
    }
    return false;
  };

  // A body ends at the first depth-0 LINE end (a newline TERMINATOR —
  // semicolon TERMINATORs separate statements INSIDE the body, for
  // every single-line introducer), enclosing closer, an
  // ELSE that is not claimed by a nested inline IF/UNLESS
  // (nested-inline-branch counting), a line-starting `.`/`?.` (a chain
  // line binds the WHOLE single-liner as its receiver, so the body ends
  // before it), an UNCLAIMED depth-0 INDENT (see below), or a comma the
  // body does not own (see above).
  //
  // INDENT claiming: a control construct opened at depth 0 INSIDE the
  // body owns its block INDENT — `m = -> f switch a` + indented arms
  // keeps the switch (blocks and all) in the body — while an INDENT no
  // body construct claims belongs to the ENCLOSING statement and ends
  // the body (`if xs.every (s) => f s` + indented then-block: the
  // block is the if's, not the arrow's). An ELSE claimed by an inline
  // IF re-arms the claim for its own block.
  const BODY_BLOCK_CLAIMERS = new Set(['IF', 'UNLESS', 'TRY', 'CATCH', 'FINALLY', 'SWITCH', 'FOR', 'CLASS']);
  const bodyEnd = (start) => {
    let depth = 0;
    let inlineIfs = 0;
    let pendingBlocks = 0;
    for (let j = start; j < tokens.length; j++) {
      if (ops.on) ops.n++;
      const t = tokens[j];
      const k = t.kind;
      if (k === 'INDENT') {
        if (depth === 0) {
          if (pendingBlocks === 0) return j;
          pendingBlocks--;
        }
        depth++;
      } else if (OPENERS.has(k)) {
        depth++;
      } else if (CLOSERS.has(k) || k === 'OUTDENT') {
        if (depth === 0) return j;
        depth--;
      } else if (depth === 0 && (k === 'IF' || k === 'UNLESS')) {
        inlineIfs++;
        pendingBlocks++;
      } else if (depth === 0 && BODY_BLOCK_CLAIMERS.has(k)) {
        pendingBlocks++;
      } else if (depth === 0 && k === 'ELSE') {
        if (inlineIfs === 0) return j;
        inlineIfs--;
        pendingBlocks++;
      } else if (depth === 0 && (k === 'TERMINATOR' && t.value !== ';')) {
        return j;
      } else if (depth === 0 && (k === '.' || k === '?.') && t.newLine) {
        return j;
      } else if (depth === 0 && k === ',' &&
                 !commaInImplicitCall(start, j) && !commaInImplicitObject(start, j)) {
        return j;
      }
    }
    return tokens.length;
  };

  const makeBlockToken = (kind, at, origin) => ({
    id: mintId(),
    kind, value: kind, start: at, end: at,
    spaced: false, newLine: false, generated: true, origin,
  });

  // Measure the body starting at `start`; return its OUTDENT frame for
  // the pending stack. The anchors and origins read the ORIGINAL tape —
  // identical to what a mutating walk would see (already-open blocks
  // contribute only generated tokens, which anchor/origin scans skip).
  const measureBody = (start) => {
    const end = bodyEnd(start);
    let firstReal = null;
    for (let j = start; j < end; j++) {
      if (ops.on) ops.n++;
      if (!tokens[j].generated) { firstReal = tokens[j]; break; }
    }
    let lastReal = null;
    for (let j = end - 1; j >= start; j--) {
      if (ops.on) ops.n++;
      if (!tokens[j].generated) { lastReal = tokens[j]; break; }
    }
    // The first real token after the body — the OUTDENT's origin. Bounded
    // scan: a whole-tail slice here is O(tape) per body, quadratic overall.
    let afterReal = null;
    for (let j = end; j < tokens.length; j++) {
      if (ops.on) ops.n++;
      if (!tokens[j].generated) { afterReal = tokens[j]; break; }
    }
    const openAt = firstReal ? firstReal.start : (tokens[start - 1]?.end ?? 0);
    return {
      end,
      firstReal,
      openAt,
      closeAt: lastReal ? lastReal.end : openAt,
      afterId: afterReal ? afterReal.id : null,
    };
  };

  let lastClosedAt = -1; // where the most recent generated block ended
  const closePendingAt = (i) => {
    while (pending.length && pending[pending.length - 1].end === i) {
      const b = pending.pop();
      insertions.push({ at: i, token: makeBlockToken('OUTDENT', b.closeAt, b.afterId) });
      lastClosedAt = i;
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    if (ops.on) ops.n++;
    closePendingAt(i);
    const t = tokens[i];
    if ((t.kind === '->' || t.kind === '=>') && tokens[i + 1] && tokens[i + 1].kind !== 'INDENT') {
      const body = measureBody(i + 1);
      insertions.push({ at: i + 1, token: makeBlockToken('INDENT', body.openAt, body.firstReal ? body.firstReal.id : null) });
      pending.push(body);
    } else if (t.kind === 'THEN') {
      // THEN becomes the block's INDENT in place (id and record persist)
      // — a retag, not an insertion; only its OUTDENT is recorded.
      const body = measureBody(i + 1);
      t.kind = 'INDENT';
      t.value = 'INDENT';
      t.generated = true;
      t.start = t.end = body.firstReal ? body.firstReal.start : t.end;
      t.origin = body.firstReal ? body.firstReal.id : null;
      pending.push(body);
    } else if (t.kind === 'ELSE' && tokens[i + 1] && tokens[i + 1].kind !== 'INDENT' && tokens[i + 1].kind !== 'IF' &&
               (lastClosedAt === i || tokens[i - 1]?.kind === 'OUTDENT')) {
      // Only an ELSE that follows a closed block is an inline else-body
      // (the OUTDENT guard). A postfix conditional's ELSE (`b if c
      // else d`) follows a plain expression and stays unwrapped — it
      // belongs to the postfix-ternary grammar rule.
      const body = measureBody(i + 1);
      insertions.push({ at: i + 1, token: makeBlockToken('INDENT', body.openAt, body.firstReal ? body.firstReal.id : null) });
      pending.push(body);
    }
  }
  closePendingAt(tokens.length);
  return insertions;
}

// Implicit function calls (the CALL portion
// only — implicit objects are a separate pass) — insertion pass #4, run
// AFTER tagPostfixConditionals so a postfix IF can never look like a
// call argument (`f if x` guards f; `f x if y` ends the call before the
// guard).
//
// Start rule: a spaced IMPLICIT_FUNC token followed by an
// IMPLICIT_CALL-able token opens a call — plus the unspaced +/- form
// (`f -1` calls, `f - 1` subtracts). End rule: an implicit call closes
// at IMPLICIT_END tokens (statement/guard boundaries; logical operators
// keep the call open when a comma follows their operand — the
// logicalKeep rule), at any enclosing closer, at INDENT unless the
// previous
// token can carry a block argument, and at end of tape. Control-flow
// constructs opening INSIDE an implicit call (CONTROL_IN_IMPLICIT)
// push a CONTROL frame so their block INDENT never closes the call —
// `f if a then 1 else 2` stays one call spanning the whole conditional.
// FOR is the one control token with a postfix form and no dedicated
// POST_ token: after a value-completing token on the same line it is a
// postfix comprehension and falls through to IMPLICIT_END, closing the
// call so the comprehension wraps it. Inserted CALL_START/CALL_END are
// generated zero-width tokens anchored at the argument extent's edges,
// so call spans stay honest.
const IMPLICIT_FUNC = new Set(['IDENTIFIER', 'PROPERTY', 'SUPER', ')', 'CALL_END', ']', 'INDEX_END', '@', 'THIS', 'DAMMIT']);
const IMPLICIT_CALL_STARTERS = new Set([
  'IDENTIFIER', 'PROPERTY', 'NUMBER', 'STRING', 'STRING_START', 'REGEX', 'HEREGEX_START',
  'PARAM_START', 'IF', 'TRY', 'SWITCH', 'CLASS', 'THIS', 'SUPER',
  'UNDEFINED', 'NULL',
  'BOOL', 'UNARY', 'DO', 'DO_IIFE', 'UNARY_MATH', 'AWAIT', 'YIELD', 'THROW', '@', '->', '=>', '[', '(', '{',
  '--', '++',
]);
const IMPLICIT_END = new Set([
  'POST_IF', 'POST_UNLESS', 'FOR', 'WHILE', 'UNTIL', 'WHEN', 'BY', 'LOOP',
  'TERMINATOR', '||', '&&', '??',
]);
// CLASS is control-in-implicit like IF/SWITCH — its body INDENT must not
// close an enclosing implicit call/object — with one extra rule:
// a BODILESS class never consumes its CONTROL frame at an INDENT, so a
// TERMINATOR pops it and the enclosing close proceeds.
const CONTROL_IN_IMPLICIT = new Set(['IF', 'TRY', 'FINALLY', 'CATCH', 'SWITCH', 'FOR', 'CLASS']);
const VALUE_END = new Set([
  'IDENTIFIER', 'PROPERTY', 'NUMBER', 'STRING', 'STRING_END', 'REGEX', 'HEREGEX_END',
  ')', 'CALL_END', ']', 'INDEX_END', '}', 'PICK_END',
  'BOOL', 'NULL', 'UNDEFINED', 'THIS', '@',
]);
const PASS_OPENERS = new Set(['(', '[', '{', 'PICK_START', 'OPTPICK_START', 'CALL_START', 'INDEX_START', 'PARAM_START', 'STRING_START', 'INTERPOLATION_START', 'HEREGEX_START', 'INDENT']);
const PASS_CLOSERS = new Set([')', ']', '}', 'PICK_END', 'CALL_END', 'INDEX_END', 'PARAM_END', 'STRING_END', 'INTERPOLATION_END', 'HEREGEX_END', 'OUTDENT']);

// The implicit-call START predicate: will the call pass open a call
// after token j? A spaced call-starter argument — or a spread of one
// (`g ...args`) — following a
// callable token, minus the closer-before-arrow exclusion. Shared by
// the call pass itself and by every cross-pass reconstruction site:
// implicitBlocks' comma ownership, implicitObjects' startsLine
// and open-call scans. The unspaced `+`/`-` form (`f -1`) belongs to
// the call pass's start site ONLY — the shared predicate deliberately
// excludes it, keeping the reconstruction sites consistent.
const startsImplicitCall = (tokens, j) => {
  const t = tokens[j];
  const next = tokens[j + 1];
  if (!t || !next || !next.spaced || !IMPLICIT_FUNC.has(t.kind)) return false;
  if ((t.kind === ']' || t.kind === '}') && (next.kind === '->' || next.kind === '=>')) return false;
  if (IMPLICIT_CALL_STARTERS.has(next.kind)) return true;
  return next.kind === '...' && tokens[j + 2] != null && IMPLICIT_CALL_STARTERS.has(tokens[j + 2].kind);
};

// Does the expression starting at j read as a
// `key:` pair? (`@key:`, `token:`, or a balanced bracket group followed
// by `:`.) Shared by implicitBlocks (comma ownership) and
// implicitObjects (continuation decisions).
const looksObjectishAt = (tokens, j) => {
  if (!tokens[j]) return false;
  // A void-method key reads objectish too (`fn!:` / `@fn!:`) — the
  // bang is still DAMMIT on forward looks (the `:` handler retags it
  // when the walk arrives) and VOID_MARKER after.
  const bangColon = (a) =>
    (tokens[a]?.kind === 'DAMMIT' || tokens[a]?.kind === 'VOID_MARKER') && tokens[a + 1]?.kind === ':';
  if (tokens[j].kind === '@' && (tokens[j + 2]?.kind === ':' || bangColon(j + 2))) return true;
  if (tokens[j + 1]?.kind === ':' || bangColon(j + 1)) return true;
  if (PASS_OPENERS.has(tokens[j].kind)) {
    let d = 1;
    let k = j;
    while (++k < tokens.length && d > 0) {
      if (ops.on) ops.n++;
      if (PASS_OPENERS.has(tokens[k].kind)) d++;
      else if (PASS_CLOSERS.has(tokens[k].kind)) d--;
    }
    if (d === 0 && tokens[k]?.kind === ':') return true;
  }
  return false;
};
const BLOCK_ARG_CARRIERS = new Set(['->', '=>', '[', '(', ',', '{', 'ELSE', '=']);
const LINE_BREAK_KINDS = new Set(['INDENT', 'OUTDENT', 'TERMINATOR']);

// Control-flow heads that OWN a following INDENT: an IMPLICIT_FUNC token
// at the end of such a header line (`if f` + indented pairs) is part of
// the header, so the indented object is the construct's block body, not
// a call argument. DEF belongs here too — a def's INDENT is its body,
// and wrapping it as a call argument would miscompile the def.
const CALL_BLOCKING_HEADS = new Set(['CLASS', 'EXTENDS', 'IF', 'CATCH', 'SWITCH', 'LEADING_WHEN', 'FOR', 'WHILE', 'UNTIL', 'DEF']);

// Does the current line (scanning backward from j at bracket level 0)
// carry a control-flow head? MATCHED bracket pairs are skipped entirely —
// a head to the left of a balanced pair still owns the INDENT (`def m()`:
// the DEF must be visible past the params' parens). An UNMATCHED real
// opener or a line-break token bounds the line; unmatched generated
// braces (implicit-object wrappers) pass through.
const controlHeadBackwards = (tokens, j) => {
  let depth = 0;
  for (; j >= 0; j--) {
    if (ops.on) ops.n++;
    const k = tokens[j].kind;
    if (depth === 0 && CALL_BLOCKING_HEADS.has(k)) return true;
    if (PASS_CLOSERS.has(k)) {
      depth++;
      continue;
    }
    if (PASS_OPENERS.has(k)) {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (!tokens[j].generated || LINE_BREAK_KINDS.has(k)) return false;
      continue;
    }
    if (depth === 0 && LINE_BREAK_KINDS.has(k)) return false;
  }
  return false;
};

// Implicit objects (the OBJECT portion) —
// insertion pass #5's partner, run BEFORE implicitCalls. Calls and
// objects are separate passes; splitting them requires an order, and
// objects-first is the one that composes: the object pass wraps `key:`
// runs in generated `{`/`}` (real brace tokens by the time the call
// pass runs), so the call pass's existing bracket-frame discipline
// handles every interleaving for free — `f a: 1 && 2` keeps the call
// open because the `&&` sits inside the object's brace frame (logical
// operators never close implicit objects, and an object frame
// atop the call shields it). Calls-first would instead need the call
// pass to reconstruct not-yet-inserted object state at every boundary.
// The ONE fact objects-first must import from the call pass is
// call-before-key precedence (a call opening at the key's own
// position takes the key as its first argument): `startsLine`
// is false when the call pass WILL open a call before the key —
// evaluated with the call pass's own start predicate.
//
// Start rule: a non-ternary `:` starts an implicit object at its
// key (`@`-prefixed keys start at the `@`; a closer before the `:`
// starts at the enclosing frame's start) — unless the pair is already
// inside a brace context (explicit `{`, the current implicit object,
// or a brace's INDENT block). End rule: single-line objects
// (sameLine) close at IMPLICIT_END boundaries except logical operators
// (`a: 1 && 2` binds the value) and except a POST_IF/POST_UNLESS whose
// property list continues (the guard binds the first line's value —
// objectContinues below); multi-line objects (startsLine) stay open
// across TERMINATOR while the next line looks objectish; a comma whose
// next element is not objectish closes (`x = a: 1, b` is an object
// then a syntax error); enclosing closers and INDENT (unless
// the previous token is `:` — an indented VALUE — or a block-argument
// carrier) close; end of tape closes. CONTROL_IN_IMPLICIT frames
// shield an object from a control construct's block INDENT exactly as
// in the call pass. Inserted `{`/`}` are zero-width generated tokens:
// `{` anchored at the key's start (origin = the key), `}` at the last
// real token's end (origin = that token) — object spans in
// NodeStore/MappingStore are the real source extent by construction.
export function implicitObjects(tokens, mintId) {
  // Frames: openers/'INDENT' as {kind, at}; implicit objects as
  // {kind: 'object', at, sameLine, startsLine}; 'CONTROL' as {kind}.
  const stack = [];
  const insertions = []; // {at, token} against original indices
  // Pending ternaries per bracket depth: each `?` claims the next ':'
  // at ITS depth, so nested and sequential ternaries pair
  // innermost-first (the tagDynamicKeys discipline) and a
  // parenthesized inner ternary never leaks its claim to the outer
  // colon.
  const pendingTernary = [0];
  let lastReal = null;

  const top = () => stack[stack.length - 1];

  const makeBrace = (kind, at, origin, flags = {}) => ({
    id: mintId(),
    kind, value: kind, start: at, end: at,
    spaced: flags.spaced ?? false, newLine: flags.newLine ?? false,
    generated: true, origin,
  });

  const closeObject = (at) => {
    stack.pop();
    insertions.push({ at, token: makeBrace('}', lastReal ? lastReal.end : 0, lastReal ? lastReal.id : null) });
  };

  const looksObjectish = (j) => looksObjectishAt(tokens, j);

  // Is an implicit CALL open between tape position `from` (exclusive)
  // and `i`? The call pass runs after this one, so its frames don't
  // exist yet — backward reconstruction answers the question:
  // walk back at bracket level 0 looking for the call pass's start
  // pattern (spaced IMPLICIT_FUNC + call-starter). A TERMINATOR or a
  // level-0 INDENT means any such call already closed (in-scope
  // calls never span an unbracketed TERMINATOR).
  // Decides whether a `,` or `key:` sits inside the pair's VALUE call
  // (the comma feeds the
  // call and the key starts a NESTED object) or at the object's own
  // level (the comma/key continues or ends the property list).
  const openCallBetween = (from, i) => {
    let levels = 0;
    for (let j = i - 1; j > from; j--) {
      if (ops.on) ops.n++;
      const k = tokens[j].kind;
      if (PASS_CLOSERS.has(k)) { levels++; continue; }
      if (PASS_OPENERS.has(k)) {
        if (k === 'INDENT' && levels === 0) return false;
        levels--;
        if (levels < 0) return false;
        continue;
      }
      if (levels > 0) continue;
      if (k === 'TERMINATOR') return false;
      if (startsImplicitCall(tokens, j)) return true;
    }
    return false;
  };

  // objectContinues: from j, does the current property list reach
  // a depth-0 TERMINATOR followed by another objectish line (i.e. the
  // multi-line object continues past this point)?
  const objectContinues = (j) => {
    for (let d = 0; j < tokens.length; j++) {
      if (ops.on) ops.n++;
      const k = tokens[j].kind;
      if (PASS_OPENERS.has(k)) d++;
      else if (PASS_CLOSERS.has(k)) {
        if (d === 0) return false;
        d--;
      } else if (k === 'TERMINATOR' && d === 0) {
        return looksObjectish(j + 1);
      }
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i++) {
    if (ops.on) ops.n++;
    const t = tokens[i];
    const k = t.kind;
    const prev = tokens[i - 1];
    if (prev && !prev.generated) lastReal = prev;

    // A control construct opening directly inside an implicit object
    // becomes part of the pair's VALUE: its CONTROL frame shields the
    // object from the construct's block INDENT. Postfix FOR falls
    // through to IMPLICIT_END (the comprehension wraps the object).
    if (top()?.kind === 'object' && CONTROL_IN_IMPLICIT.has(k) &&
        !(k === 'FOR' && !t.newLine && prev && VALUE_END.has(prev.kind))) {
      stack.push({ kind: 'CONTROL', trigger: k });
      continue;
    }

    if (k === 'INDENT') {
      // INDENT closes a same-line object — except after `:` (the pair's
      // value is the indented block) or a block-argument carrier — and
      // consumes the CONTROL frame whose block this is.
      if (prev && !BLOCK_ARG_CARRIERS.has(prev.kind)) {
        while (top()?.kind === 'object' && prev.kind !== ':') closeObject(i);
      }
      if (top()?.kind === 'CONTROL') stack.pop();
      stack.push({ kind: 'INDENT', at: i });
      pendingTernary.push(0);
      continue;
    }
    if (PASS_OPENERS.has(k)) {
      stack.push({ kind: k, at: i });
      pendingTernary.push(0);
      continue;
    }
    if (PASS_CLOSERS.has(k)) {
      while (top()?.kind === 'object' || top()?.kind === 'CONTROL') {
        if (top().kind === 'object') closeObject(i);
        else stack.pop();
      }
      stack.pop();
      if (pendingTernary.length > 1) pendingTernary.pop();
      // A dedent is a line break: objects still open below the popped
      // block are no longer same-line.
      if (k === 'OUTDENT') {
        for (let d = stack.length - 1; d >= 0; d--) {
          const fr = stack[d];
          if (fr.kind !== 'object' && fr.kind !== 'CONTROL') break;
          if (fr.kind === 'object') fr.sameLine = false;
        }
      }
      continue;
    }

    if (k === 'TERNARY') pendingTernary[pendingTernary.length - 1]++;

    if (k === ':') {
      const pt = pendingTernary.length - 1;
      if (pendingTernary[pt] > 0) {
        pendingTernary[pt]--;
        continue;
      }
      // A non-ternary colon whose key carries a trailing bang is a
      // VOID-METHOD pair (`fn!: ->`): this is the context that resolves
      // the scanner's DAMMIT into VOID_MARKER (a ternary's colon was
      // consumed above, so `c ? f!: g` keeps its call-site dammit).
      if (prev?.kind === 'DAMMIT') prev.kind = 'VOID_MARKER';
      const bang = prev?.kind === 'VOID_MARKER' ? 1 : 0;

      // The key's start: normally the previous token (one further back
      // past a void marker); `@`-prefixed keys start at the `@`; a
      // closer before the `:` starts the pair at the enclosing frame's
      // start (forms this admits beyond the grammar
      // still produce a consistent tape and reject loudly at parse).
      let s = PASS_CLOSERS.has(prev?.kind) ? (top()?.at ?? i - 1) : i - 1 - bang;
      if (tokens[i - 2 - bang]?.kind === '@') s = i - 2 - bang;

      // startsLine — with the two-pass bridge: a key OPENING an
      // implicit call is never line-starting. The call pass runs after
      // this one; evaluate its start predicate directly.
      const before = tokens[s - 1];
      const callWillOpen = startsImplicitCall(tokens, s - 1);
      const startsLine = !callWillOpen &&
        (s <= 0 || LINE_BREAK_KINDS.has(before?.kind) || Boolean(before?.newLine));

      // Already inside a brace context: an explicit `{`, the current
      // implicit object, or a brace's INDENT block — this `:` is a
      // continuing pair, not a new object —
      // UNLESS an implicit call opened since the enclosing pair
      // boundary: then this key sits inside the pair's VALUE and
      // starts a NESTED object fed to that call
      // (`x = a: 1, b: f 2, c: 3` is {a: 1, b: f(2, {c: 3})}).
      const f = top();
      const under = stack[stack.length - 2];
      const isBraceFrame = (fr) => fr && (fr.kind === '{' || fr.kind === 'PICK_START' || fr.kind === 'OPTPICK_START' || fr.kind === 'object');
      const isBraceKind = (kd) => kd === '{' || kd === 'PICK_START' || kd === 'OPTPICK_START';
      if (f && (isBraceFrame(f) || (f.kind === 'INDENT' && isBraceKind(under?.kind))) &&
          !openCallBetween(f.at, s) &&
          (startsLine || before?.kind === ',' || isBraceKind(before?.kind) || tokens[s]?.kind === '{')) {
        continue;
      }

      stack.push({ kind: 'object', at: s, sameLine: true, startsLine });
      insertions.push({
        at: s,
        token: makeBrace('{', tokens[s].start, tokens[s].id, { spaced: tokens[s].spaced, newLine: tokens[s].newLine }),
      });
      continue;
    }

    // A line-starting `.`/`?.` (a chain line) closes a same-line object
    // exactly like a non-TERMINATOR boundary: the chain's receiver is the
    // completed object (`x = a: b` + `.c` line reads `({a: b}).c`).
    if (IMPLICIT_END.has(k) || ((k === '.' || k === '?.') && t.newLine)) {
      // Logical operators never close an implicit object — the operator
      // binds the pair's value (`x = a: 1 && 2` is {a: (1 && 2)}).
      if (k === '||' || k === '&&' || k === '??') continue;
      if (k === 'TERMINATOR') {
        // A statement boundary clears unconsumed ternary claims at
        // this depth and un-samelines every open implicit frame.
        pendingTernary[pendingTernary.length - 1] = 0;
        for (let d = stack.length - 1; d >= 0; d--) {
          const fr = stack[d];
          if (fr.kind !== 'object' && fr.kind !== 'CONTROL') break;
          if (fr.kind === 'object') fr.sameLine = false;
        }
      }
      while (top()?.kind === 'object' ||
             (k === 'TERMINATOR' && top()?.kind === 'CONTROL' && top()?.trigger === 'CLASS')) {
        const fr = top();
        // A bodiless class's CONTROL frame was never consumed by an
        // INDENT; the statement boundary retires it and the close
        // proceeds to the frames beneath (the CLASS-at-TERMINATOR pop).
        if (fr.kind === 'CONTROL') {
          stack.pop();
          continue;
        }
        if (k === 'TERMINATOR') {
          if (prev?.kind !== ',' && !(fr.startsLine && looksObjectish(i + 1))) closeObject(i);
          else break;
        } else {
          if (fr.sameLine && prev?.kind !== ':' &&
              !((k === 'POST_IF' || k === 'POST_UNLESS') && objectContinues(i + 1))) closeObject(i);
          else break;
        }
      }
      continue;
    }

    // A comma whose next element is not objectish ends the property
    // list (the close lands after the comma when an OUTDENT
    // follows, before it otherwise) — unless an implicit call opened
    // inside the current pair's value: the comma feeds that call, not
    // the property list (`x = a: g 1, 2` is {a: g(1, 2)}).
    if (k === ',' && top()?.kind === 'object' && !openCallBetween(top().at, i) &&
        !looksObjectish(i + 1) &&
        (tokens[i + 1]?.kind !== 'TERMINATOR' || !looksObjectish(i + 2))) {
      const offset = tokens[i + 1]?.kind === 'OUTDENT' ? 1 : 0;
      while (top()?.kind === 'object') closeObject(i + offset);
    }
  }

  if (tokens.length && !tokens[tokens.length - 1].generated) lastReal = tokens[tokens.length - 1];
  while (top()?.kind === 'object' || top()?.kind === 'CONTROL') {
    if (top().kind === 'object') closeObject(tokens.length);
    else stack.pop();
  }
  return insertions;
}

export function implicitCalls(tokens, mintId) {
  const stack = []; // 'call' markers interleaved with bracket frames
  const insertions = []; // {at, token} against original indices
  // The INDENT that carries a just-opened indented-object call argument
  // (`f` + indented `a: 1` pairs): it belongs to the call, so the INDENT
  // handler must not close it.
  let callIndentAt = -1;

  const makeCallToken = (kind, at, origin) => ({
    id: mintId(),
    kind, value: kind === 'CALL_START' ? '(' : ')',
    start: at, end: at,
    spaced: false, newLine: false, generated: true, origin,
  });

  // The most recent non-generated token before the walk position — the
  // CALL_END anchor (a close's argument extent ends at the last REAL
  // token, never at a synthetic INDENT/OUTDENT).
  let lastReal = null;

  const closeCall = (at) => {
    stack.pop();
    insertions.push({ at, token: makeCallToken('CALL_END', lastReal ? lastReal.end : 0, lastReal ? lastReal.id : null) });
  };

  for (let i = 0; i < tokens.length; i++) {
    if (ops.on) ops.n++;
    const t = tokens[i];
    const next = tokens[i + 1];
    const k = t.kind;
    if (i > 0 && !tokens[i - 1].generated) lastReal = tokens[i - 1];

    // A control-flow construct opening directly inside an implicit call
    // becomes the call's argument: its CONTROL frame shields the call
    // from the construct's own INDENT and boundary tokens. Postfix FOR
    // (a value-completing token precedes it on the same line) is the
    // exception — it falls through to IMPLICIT_END so the comprehension
    // wraps the call instead of feeding it.
    if (stack[stack.length - 1] === 'call' && CONTROL_IN_IMPLICIT.has(k) &&
        !(k === 'FOR' && !t.newLine && tokens[i - 1] && VALUE_END.has(tokens[i - 1].kind))) {
      stack.push(k === 'CLASS' ? 'CONTROL_CLASS' : 'CONTROL');
      continue;
    }

    // INDENT: closes open implicit calls unless the previous token can
    // carry a block argument (`run ->` + block stays one call) or the
    // INDENT carries a just-opened indented-object argument — and
    // consumes the CONTROL frame whose block this is.
    if (k === 'INDENT') {
      if (i === callIndentAt) {
        stack.push('INDENT');
        continue;
      }
      const prev = tokens[i - 1];
      if (!prev || !BLOCK_ARG_CARRIERS.has(prev.kind)) {
        while (stack[stack.length - 1] === 'call') closeCall(i);
      }
      if (stack[stack.length - 1] === 'CONTROL' || stack[stack.length - 1] === 'CONTROL_CLASS') stack.pop();
      stack.push('INDENT');
      continue;
    }
    if (PASS_OPENERS.has(k)) {
      stack.push(k);
      // No continue: '(' etc. are never IMPLICIT_FUNC, and falling
      // through keeps one code path.
    } else if (PASS_CLOSERS.has(k)) {
      while (stack[stack.length - 1] === 'call' || stack[stack.length - 1] === 'CONTROL' || stack[stack.length - 1] === 'CONTROL_CLASS') {
        if (stack[stack.length - 1] === 'call') closeCall(i);
        else stack.pop();
      }
      stack.pop();
      // No continue: a closer (CALL_END, ')', ']', INDEX_END) is itself
      // an IMPLICIT_FUNC — `f(1) 2` starts a new implicit call.
    }

    // A line-starting `.`/`?.` closes open implicit calls: the chain
    // binds the completed call as its receiver (`f x` + `.g y` line
    // reads `f(x).g(y)`).
    if (IMPLICIT_END.has(k) || ((k === '.' || k === '?.') && t.newLine)) {
      const isLogical = k === '||' || k === '&&' || k === '??';
      let keep = false;
      if (isLogical) {
        // logicalKeep: the call stays open when a comma directly
        // follows the operand after the logical operator (one atom, or
        // one balanced bracket group) — anything wider
        // would silently accept programs the language rejects.
        let j = i + 1;
        let o = tokens[j]?.kind;
        if (o === '(' || o === '[' || o === '{') {
          for (let d = 1; ++j < tokens.length && d > 0;) {
            if (ops.on) ops.n++;
            o = tokens[j].kind;
            if (o === '(' || o === '[' || o === '{') d++;
            else if (o === ')' || o === ']' || o === '}') d--;
          }
        } else if (o && o !== 'TERMINATOR' && o !== 'OUTDENT' && o !== ',') {
          j++;
        }
        keep = tokens[j]?.kind === ',';
      }
      if (!keep && tokens[i - 1]?.kind !== ',') {
        // A CONTROL frame on top shields the call: the boundary token
        // belongs to the control construct, not the call — except
        // a bodiless class's frame at a statement boundary, which was
        // never consumed by an INDENT: the TERMINATOR retires it and
        // the close proceeds (the CLASS-at-TERMINATOR pop).
        while (stack[stack.length - 1] === 'call' ||
               (k === 'TERMINATOR' && stack[stack.length - 1] === 'CONTROL_CLASS')) {
          if (stack[stack.length - 1] === 'call') closeCall(i);
          else stack.pop();
        }
      }
      continue;
    }

    if (
      startsImplicitCall(tokens, i) ||
      (IMPLICIT_FUNC.has(k) && next && next.spaced &&
        (next.kind === '+' || next.kind === '-') && tokens[i + 2] && !tokens[i + 2].spaced && !tokens[i + 2].newLine)
    ) {
      // Origins resolve to REAL tokens: when the argument opens with a
      // generated token (an implicitObjects `{`), anchor through it.
      insertions.push({ at: i + 1, token: makeCallToken('CALL_START', next.start, next.generated ? next.origin : next.id) });
      stack.push('call');
    } else if (IMPLICIT_FUNC.has(k) && next?.kind === 'INDENT' &&
               tokens[i + 2]?.kind === '{' && tokens[i + 2].generated &&
               !controlHeadBackwards(tokens, i)) {
      // Indented-object call argument: a callable at the end of its line
      // with an indented `key:` body calls it (`f` / `r = m()` + indented
      // pairs). The object pass has already wrapped the pairs in a
      // generated brace, which is the objectish evidence; a control-flow
      // head on the line owns the INDENT instead (its block body). The
      // call opens BEFORE the INDENT — the block is the argument — and
      // the INDENT is marked as call-owned so the INDENT handler keeps
      // the call open.
      insertions.push({ at: i + 1, token: makeCallToken('CALL_START', tokens[i + 2].start, tokens[i + 2].origin) });
      stack.push('call');
      callIndentAt = i + 1;
    }
  }

  if (tokens.length && !tokens[tokens.length - 1].generated) lastReal = tokens[tokens.length - 1];
  while (stack[stack.length - 1] === 'call' || stack[stack.length - 1] === 'CONTROL' || stack[stack.length - 1] === 'CONTROL_CLASS') {
    if (stack[stack.length - 1] === 'call') closeCall(tokens.length);
    else stack.pop();
  }
  return insertions;
}

// Postfix-conditional tagging:
// an IF/UNLESS that reaches its statement end (TERMINATOR, OUTDENT, or
// end of tape) before any INDENT is a postfix conditional — the guard of
// the expression before it — and retags to POST_IF/POST_UNLESS. A
// prefix conditional always opens its block (INDENT) first. Retag-only,
// per the retag-pass contract.
export function tagPostfixConditionals(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (ops.on) ops.n++;
    const kind = tokens[i].kind;
    if (kind !== 'IF' && kind !== 'UNLESS') continue;
    let postfix = true;
    let depth = 0;
    // The inner scan runs to the conditional's line end, skipping
    // BALANCED regions (bracket pairs and nested single-liner bodies —
    // an INDENT directly after an arrow/ELSE/TRY/FINALLY belongs to
    // that introducer, not to the conditional). A depth-0 INDENT under
    // any other predecessor is a block: the conditional is a prefix if
    // (a then-body if is one too — THEN has already retagged to its
    // block's INDENT with the condition's last token before it). The
    // scan's bound is O(line length) per IF/UNLESS — quadratic only
    // for a single unterminated line of chained postfix conditionals
    // (`a if b if c if …` with no newline), which is valid input;
    // linear for every program with normal lines.
    for (let j = i + 1; j < tokens.length; j++) {
      if (ops.on) ops.n++;
      const k = tokens[j].kind;
      if (depth === 0) {
        if (k === 'TERMINATOR') break; // line end — postfix
        if (k === 'INDENT') {
          const p = tokens[j - 1]?.kind;
          if (p !== '->' && p !== '=>' && p !== 'ELSE' && p !== 'TRY' && p !== 'FINALLY') {
            postfix = false; // its own (or the statement's) block
            break;
          }
        }
      }
      if (PASS_OPENERS.has(k)) {
        depth++;
      } else if (PASS_CLOSERS.has(k)) {
        depth--;
        if (depth < 0) break; // enclosing close — postfix
      }
    }
    if (postfix) tokens[i].kind = kind === 'IF' ? 'POST_IF' : 'POST_UNLESS';
  }
  return tokens;
}

// Adapter implementing the generated parser's lexer protocol:
//   setInput(input) then lex() → kind (falsy at EOF), exposing .text and
//   .loc = {start, end} after each lex(). A FRESH loc object is allocated
//   per token — the parser stores loc references on its location stack.
export function makeParserLexer(path = '<anonymous>') {
  return {
    setInput(input) {
      const tape = tokenize(input, path);
      this.tokens = tape.tokens;
      this.trivia = tape.trivia;
      this.source = tape.source;
      this.index = 0;
      this.text = '';
      this.loc = null;
    },
    lex() {
      const t = this.tokens[this.index];
      if (!t) return null;
      this.index++;
      this.text = t.value;
      this.loc = { start: t.start, end: t.end };
      return t.kind;
    },
  };
}
