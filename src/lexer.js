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
import { SCHEMA_SCAN, SCHEMA_PRAGMA_KEYS, finishSchemas, explainSchemaReject } from './schema.js';
import { rewriteRender } from './render.js';
import { TEMPLATE_TAGS } from './dom.js';
import { counter, syncCounterFlag } from './counter.js';
// The identifier character classes; the scanner walks characters, so it
// takes the classes rather than the helpers built on them.
import { IDENT_START, IDENT_PART, isIdentifierName, identifierMatches, identifierRunAt } from './ident.js';

// `is not` and a `get`/`set` accessor head, bounded by the identifier
// classes so a word that merely starts with `not` or a name stays a word.
const NOT_WORD = new RegExp(`^[ \\t]+not(?!${IDENT_PART.source})`);
const ACCESSOR_HEAD = new RegExp(`^[ \\t]+(get|set)[ \\t]+(?=${IDENT_START.source}|[@"'])`);
// The three insertion passes; each applies itself. The passes that never
// add tokens (retagTape, tagCompoundKeys, tagPostfixConditionals) stay
// here.
import {
  implicitBlocks, implicitObjects, implicitCalls,
  NESTING, TernaryClaims, IMPLICIT_FUNC,
} from './implicit.js';
// The type-annotation collapse pass, plus the four type-shape
// predicates the SCANNER consults: a trailing `<` continues a line only
// if it opened a type generic rather than a comparison, and only type
// shape can say which.
import {
  rewriteTypes,
  typeAliasEq, atStatementBoundary, beforeAngleGroupBack, closesTypeGeneric,
} from './types.js';

// ── Pipeline: post-scan passes ──────────────────────────────────────────
// A retag pass (retagTape, tagPostfixConditionals) takes the finished
// TokenTape and changes token KINDS in place — never inserts or deletes
// records — so tape indices and origins stay stable by construction.
// The passes that change the tape's length do it without a splice per
// change: rewriteTypes and rewriteRender build a fresh array; the
// implicit passes and finishLayout's commas collect insertions against
// original indices and apply them in one backward merge. tagCompoundKeys
// is the exception: it collapses each compound key with one splice.

// The three retags the scanner's tape needs before any rewrite pass,
// in ONE forward walk: arrow parameter lists, dynamic keys and
// definition-site void markers. No decision reads a kind another of
// them rewrites except by class — `(`/PARAM_START and INDEX_START/`[`
// count alike in every depth scan — so walking them together retags
// exactly as three walks in a row would.
export function retagTape(tokens) {
  const ternary = new TernaryClaims();
  for (let i = 0; i < tokens.length; i++) {
    if (counter.on) counter.n++;
    const kind = tokens[i].kind;
    if (kind === '->' || kind === '=>') tagParamsAt(tokens, i);
    else if (kind === 'INDEX_START' && !ternary.pending) tagDynamicKeyAt(tokens, i);
    else if (kind === 'DAMMIT') tagVoidMarkerAt(tokens, i);
    ternary.step(tokens[i].kind);
  }
  return tokens;
}

// Arrow-function parameter tagging: when
// an arrow follows a `)`, the matching plain `(` … `)` pair retags to
// PARAM_START … PARAM_END. A CALL_START match means the parens belong to
// a call — the arrow is parameterless and nothing retags. A DO directly
// before the function (its arrow, or its param list's opener) retags to
// DO_IIFE — `do ->` and `do (x) ->` are the immediate-invocation forms.
function tagParamsAt(tokens, i) {
  {
    let closeAt = i - 1;
    let close = tokens[closeAt];
    if (!close) return;
    if (close.kind === 'DO') {
      close.kind = 'DO_IIFE';
      return;
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
        if (counter.on) counter.n++;
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
      if (found < 0) return;
      closeAt = found;
      close = tokens[closeAt];
    } else {
      // The ')' before the arrow can close a PARENTHESIZED return
      // type: `(x): (R) =>`. If a ':' preceded by ')' sits before this
      // group's '(', the real param close is that earlier ')'.
      let d = 0;
      let op = -1;
      for (let k = i - 1; k >= 0; k--) {
        if (counter.on) counter.n++;
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
      if (counter.on) counter.n++;
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
}

// Dynamic-key detection: an INDEX pair whose closing bracket is directly
// followed by ':' is an object KEY (`{@[k]: v}`, `{a[i]: v}` shapes), not
// an index — both brackets retag to their plain kinds so the grammar's
// dynamic-key rules see `[ Expression ]`. The one ':' that must NOT
// trigger this is a ternary's (TernaryClaims: `a ? b[k] : c` keeps its
// index). The inner matching scan is O(pair length) per INDEX_START —
// quadratic only for pathologically nested index chains, linear for
// normal programs (the tagPostfixConditionals bound).
function tagDynamicKeyAt(tokens, i) {
  let depth = 1;
  let j = i;
  while (++j < tokens.length && depth > 0) {
    if (counter.on) counter.n++;
    if (NESTING[tokens[j].kind] === 1) depth++;
    else if (NESTING[tokens[j].kind] === -1) depth--;
  }
  // j sits one past the close when depth reached 0.
  if (depth === 0 && tokens[j]?.kind === ':') {
    tokens[i].kind = '[';
    tokens[j - 1].kind = ']';
  }
}

// Commaless call arguments: inside a call, an arrow directly after a
// completed LITERAL argument reads as the next argument — the comma
// is implied: `get '/users' -> handler` is `get('/users', handler)`.
// The comma is a zero-width ',' at the arrow's start (a synthesized
// separator, the zero-width row discipline). Identifier-ended
// arguments do NOT trigger (`f x -> 1` keeps its reading: x is not a
// literal, so explicit comma rules apply). finishLayout inserts it.
const ARROW_COMMA_AFTER = new Set([
  'STRING', 'STRING_END', 'REGEX', 'HEREGEX_END', 'NUMBER',
  'BOOL', 'NULL', 'UNDEFINED', ']', '}', 'SYMBOL',
]);

// Compound object keys: an IDENTIFIER/PROPERTY chain joined by `.`
// (any spacing) or `-` (tight on both sides — spaced subtraction and
// line-broken expressions keep their readings) and followed directly
// by `:` is ONE string key: `{ data-src: 1 }`, `{ www.amazon.com: 4 }`,
// `{ beta-site.amazon.com: 2 }`. The chain collapses to a STRING token
// spanning the written chain; the value concatenates the parts
// (spacing around dots drops). A ternary's `:` never claims —
// `a ? b.c : d` keeps its member read (TernaryClaims).
export function tagCompoundKeys(tokens) {
  const identish = (x) => x !== undefined && (x.kind === 'IDENTIFIER' || x.kind === 'PROPERTY');
  const ternary = new TernaryClaims();
  for (let i = 0; i < tokens.length; i++) {
    if (counter.on) counter.n++;
    if (identish(tokens[i]) && !ternary.pending &&
               tokens[i - 1]?.kind !== '.' && tokens[i - 1]?.kind !== '?.' &&
               tokens[i - 1]?.kind !== '@') {
      let j = i;
      for (;;) {
        if (counter.on) counter.n++;
        const sep = tokens[j + 1];
        const nxt = tokens[j + 2];
        if (sep === undefined || !identish(nxt)) break;
        if (sep.kind === '.') { j += 2; continue; }
        if (sep.kind === '-' && sep.start === tokens[j].end && nxt.start === sep.end) { j += 2; continue; }
        break;
      }
      if (j > i && tokens[j + 1]?.kind === ':') {
        let buf = '';
        for (let m = i; m <= j; m++) buf += tokens[m].value;
        const collapsed = { ...tokens[i], kind: 'STRING', value: JSON.stringify(buf), end: tokens[j].end };
        tokens.splice(i, j - i + 1, collapsed);
      }
    }
    ternary.step(tokens[i].kind);
  }
  return tokens;
}

// ── Definition-site void markers ─────────────────────────────────────
// A trailing `!` on a function's NAME at a definition site means the
// function is VOID (implicit return suppressed). The scanner mints
// every unspaced post-name `!` as DAMMIT (call-plus-await sugar); this
// retag pass resolves the two definition contexts one adjacency check
// decides — the LALR table cannot (an `Identifier . DAMMIT` state would
// need the token AFTER the bang to choose between the dammit reduce
// and a definition shift):
//   - assign definition: DAMMIT directly before a `=` or `=!` token
//     (`save! = ->`, `save! =! ->`; a spaced `!` never lexes DAMMIT, `!=` after a
//     name is a scan-time rejection, `==` lexes COMPARE whole)
//   - def definition: DEF Identifier DAMMIT (`def save!(x)`), or the
//     static DEF @ Property DAMMIT (`def @save!(x)`)
// The third context — an object/class METHOD KEY (`fn!: ->`) — resolves
// inside implicitObjects, the pass that knows whether a `:` is a
// ternary's (`c ? f!: g` keeps the dammit) or a pair's.
function tagVoidMarkerAt(tokens, i) {
  if (tokens[i + 1]?.kind === '=' || tokens[i + 1]?.kind === 'READONLY_ASSIGN' ||
      (tokens[i - 1]?.kind === 'IDENTIFIER' && tokens[i - 2]?.kind === 'DEF') ||
      (tokens[i - 1]?.kind === 'PROPERTY' && tokens[i - 2]?.kind === '@' && tokens[i - 3]?.kind === 'DEF')) {
    tokens[i].kind = 'VOID_MARKER';
  }
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
  // `do` scans as DO; retagTape retags it to DO_IIFE, the immediate
  // invocation of the function literal that follows.
  do: 'DO',
  // Components. `component` and `render` are keywords
  // everywhere (property/key positions capture first, so `x.render`
  // and `render: 1` stay legal); `offer`/`accept` are CONTEXT-
  // sensitive — keywords only lexically inside a component body
  // (the scanner's `component` mode frame decides, never this table).
  component: 'COMPONENT',
  render: 'RENDER',
};

// Pure statements: the token value is the statement itself.
const STATEMENTS = new Set(['break', 'continue', 'debugger']);

// Keywords and JS reserved words with no feature behind them yet
// (`private` has one position: the class-member modifier, scanned
// PRIVATE at the head of a member line and reserved everywhere else;
// `enum` and `new` reject naming the forms that cover them — `new` is
// otherwise `new.target` and a TS constructor type, `new () => T`).
// They must never reach the parser as IDENTIFIER: with implicit calls
// live, `new Date` would otherwise compile silently to a CALL of a
// reserved word — invalid or wrong JS. Property positions (`a.new`,
// `new: 1`) stay legal. They scan as RESERVED
// tokens so a type-annotation run can absorb them (`(cb: () => void)`
// — TS types legitimately spell reserved words); any RESERVED token
// that survives rewriteTypes rejects loudly from its own position.
const RESERVED_WORDS = new Set([
  'default', // contextual: DEFAULT inside import/export lines only
  'function', 'var', 'let', 'const', 'void', 'with', 'case',
  'enum', 'implements', 'interface', 'package', 'new',
  'private', 'protected', 'public', 'static', 'native',
]);

// Word aliases for operators: the token VALUE is the
// operator; the span covers the word.
export const ALIASES = {
  __proto__: null,
  and: ['&&', '&&'],
  or: ['||', '||'],
  not: ['UNARY', '!'], // word-not is UNARY; symbol ! is UNARY_MATH
  typeof: ['UNARY', 'typeof'],
  delete: ['UNARY', 'delete'],
  instanceof: ['RELATION', 'instanceof'],
  is: ['COMPARE', '=='],
  isnt: ['COMPARE', '!='],
  yes: ['BOOL', 'true'],
  no: ['BOOL', 'false'],
};

// Value-ending token kinds that can HEAD a tagged template: a string
// right against one of these (or bridged by `$`) is `tag\`…\``, never
// a call argument.
// Where a template line starts, and the heads of a line an inline branch
// opens (`if ok then div#main`).
const SELECTOR_LINE_STARTS = new Set(['TERMINATOR', 'INDENT', 'OUTDENT', 'RENDER']);
const SELECTOR_BRANCH_HEADS = new Set(['IF', 'UNLESS', 'ELSE', 'LEADING_WHEN']);
const TAGGABLE = new Set(['IDENTIFIER', 'PROPERTY', ')', 'CALL_END', ']', 'INDEX_END']);

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
  // Render-ready gate: only the ADJACENT pair is one token. A spaced
  // `< ~` run keeps the ordinary comparison followed by unary bitwise
  // negation, so existing programs retain that reading.
  '<~': 'GATE',
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
  // `~>` is the reactive effect head in program code; a schema body
  // spells a computed getter with it (schema mode scans its own). `!>`
  // (eager derived) exists only in schema bodies — a stray one is a loud
  // parse error. Both scan as single tokens so a trailing one never
  // reads as a line-continuing COMPARE.
  '~>': 'EFFECT', '!>': '!>',
  // The match operator: `text =~ /re/` — comparison-tier precedence,
  // deliberately non-chaining (the emitter rejects a bare chain).
  '=~': 'MATCH',
  '->': '->', '=>': '=>', '++': '++', '--': '--', '?.': '?.',
  // Map literals: ADJACENT `*{` marks the brace as a MAP (`*{a: 1}` →
  // new Map([["a", 1]])). The star claims; the `{` itself follows as
  // a normal brace so every brace pass (implicit structure, matching)
  // is untouched. A spaced `* {` keeps multiplication.
  '*{': 'MAP_START',
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
const CALLABLE = new Set(['IDENTIFIER', 'PROPERTY', ')', 'CALL_END', 'NUMBER', 'STRING', ']', 'INDEX_END', 'SUPER', 'DAMMIT', 'MAYBE_DAMMIT', 'DYNAMIC_IMPORT']);

// Token kinds after which an unspaced '[' indexes rather than opening an
// array literal (the scan-time rule: !prev.spaced && INDEXABLE.has(prev)).
// THIS and '@' index (`this[k]`, `@[k]`); an INDEX pair that turns out to
// be a dynamic KEY retags to plain brackets in retagTape.
const INDEXABLE = new Set([...CALLABLE, 'BOOL', 'NULL', 'UNDEFINED', '}', 'PICK_END', 'STRING_END', 'REGEX', 'HEREGEX_END', 'THIS', '@']);

function symbolNameEnd(text, start) {
  let end = start;
  while (end < text.length && IDENT_PART.test(text[end])) end++;
  while ((text[end] === '.' || text[end] === '-') && IDENT_START.test(text[end + 1] ?? '')) {
    end++;
    while (end < text.length && IDENT_PART.test(text[end])) end++;
  }
  // One Ruby-style trailing `!` or `?` (`:save!`, `:valid?`), claimed
  // only when the character after it cannot start an operator or
  // another token — otherwise `:a!=b`, `:a??b`, and `:a?.b` keep their
  // established comparison/coalesce/chain readings.
  if ((text[end] === '!' || text[end] === '?') &&
      (end + 1 >= text.length || SYMBOL_SUFFIX_BOUNDARY.test(text[end + 1]))) {
    end++;
  }
  return end;
}
// Does the CALL_END at tokens[end] close a def's parameter list? At
// scan time the scanner mints CALL_START for a def's parens only when
// they sit directly after its name or its bang (`def f(a)`,
// `def @f(a)`, `def f!(a)`); after type parameters they scan plain.
function closesDefParams(tokens, end) {
  let depth = 0, k = end;
  for (; k >= 0; k--) {
    const kind = tokens[k].kind;
    if (kind === 'CALL_END') depth++;
    else if (kind === 'CALL_START' && --depth === 0) break;
  }
  let n = k - 1;
  if (tokens[n]?.kind === 'DAMMIT') n--;
  const name = tokens[n];
  if (name?.kind === 'IDENTIFIER') return tokens[n - 1]?.kind === 'DEF';
  return name?.kind === 'PROPERTY' && tokens[n - 1]?.kind === '@' && tokens[n - 2]?.kind === 'DEF';
}

// The claim boundary for a symbol's `!`/`?` suffix: whitespace or a
// closer/separator that ends a value position.
const SYMBOL_SUFFIX_BOUNDARY = /[\s,)\]};:]/;
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

// Token kinds after which `schema` may begin an expression (schema mode's
// opener set): the terminals the parse table shifts SCHEMA after, in their
// scan-time spellings (a postfix IF is still IF here, a loose `else` still
// ELSE). An arrow stands for the block the implicit passes open after it.
// test/schema/schema.test.js derives the table's set and gates
// this one against it.
export const SCHEMA_OPENERS = new Set([
  'TERMINATOR', 'INDENT', '->', '=>',
  '=', 'COMPOUND_ASSIGN', 'REACTIVE_ASSIGN', 'COMPUTED_ASSIGN', 'READONLY_ASSIGN', 'EFFECT', 'MATCH',
  'RETURN', 'THROW', 'YIELD', 'FROM', 'AWAIT', 'DEFAULT', 'EXTENDS', 'OFFER', 'RENDER',
  ',', '(', '[', 'CALL_START', 'INDEX_START', 'INTERPOLATION_START', '...', '..', ':',
  'IF', 'UNLESS', 'ELSE', 'THEN', 'WHEN', 'LEADING_WHEN', 'SWITCH', 'TRY', 'FINALLY',
  'WHILE', 'UNTIL', 'LOOP', 'BY', 'FORIN', 'FOROF', 'FORAS', 'FORASAWAIT',
  'UNARY', 'UNARY_MATH', 'TERNARY',
  '+', '-', '**', 'MATH', 'SHIFT', '&', '^', '|', 'COMPARE', 'RELATION', '&&', '||', '??',
]);

// Without a kind marker a schema is told only by its body (a `;`, or a
// deeper next line), so a bare `schema` opens one only where a value
// starts a statement, an assignment or an argument — never after an
// operator, where `if a and schema` + a block is a condition.
export const SCHEMA_BARE_OPENERS = new Set([
  'TERMINATOR', 'INDENT', '->', '=>',
  '=', 'COMPOUND_ASSIGN', 'REACTIVE_ASSIGN', 'COMPUTED_ASSIGN', 'READONLY_ASSIGN',
  'RETURN', 'THROW', 'YIELD', 'AWAIT', 'DEFAULT',
  ',', '(', '[', 'CALL_START', 'INDEX_START', ':',
  'IF', 'UNLESS', 'THEN', 'WHEN', 'LEADING_WHEN', 'UNARY', 'UNARY_MATH',
]);

// `schema.<key> =` at `at` (the dot): a schema pragma's head (never `==`,
// `=>`, `=~`, `=!`), as {key, length}, or null.
const schemaPragmaAt = (text, at) => {
  if (text[at] !== '.') return null;
  const run = identifierRunAt(text, at + 1);
  if (run === null) return null;
  let j = run.end;
  while (text[j] === ' ' || text[j] === '\t') j++;
  if (text[j] !== '=' || '=>~!'.includes(text[j + 1] ?? ' ')) return null;
  return { key: run.value, length: j + 1 - at };
};

export function tokenize(text, path = '<anonymous>', { tolerant = false } = {}) {
  // The RIP_COUNT_OPS flag re-reads per call (and resets the count) so
  // a COUNT-ratio gate measures exactly one tokenize run.
  syncCounterFlag();
  const source = new SourceFile(text, path);
  const tokens = [];
  const trivia = [];
  // Tolerant-mode lexer diagnostics — rejections recorded instead of
  // thrown, same {message, start, end} shape the parser's diagnostics
  // carry; the tolerant parse merges them into its own list. Empty
  // (and never appended to) when `tolerant` is off.
  const lexDiagnostics = [];
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
  // Pending ternaries, fed by every token push (TernaryClaims — the
  // rewriters' own judgment): a `:` a pending `?` claims is its ELSE,
  // so the word before it never keys (`c ? a - b : d`) and the word
  // after it never mints a symbol (`c ? a :b`).
  const ternary = new TernaryClaims();
  let atLineStart = true;
  // The __DATA__ section: { start, text } once a marker line ends the
  // program, else null.
  let data = null;
  let lastNewlinePos = -1; // offset of the newline that ended the previous LOGICAL line
  let pendingSpaced = false;
  let pendingNewLine = false;
  // The scanner's mode stack: one frame per open context that changes
  // how a word or glyph scans, in opening order. Every context opens,
  // closes and is asked about here, and each frame closes by its own
  // rule:
  //   render       RENDER opens it at the current indent depth and
  //                bracket count; a line back at (or above) that depth
  //                leaves it. A RENDER inside it restarts it at the new
  //                depth. Inside, a TIGHT `#word` is element-id syntax
  //                (spaced `# word` stays a comment) and `.class-name`
  //                chains consume tight hyphens.
  //   render-code  inside render, a function body (`@click: ->` +
  //                INDENT) is code, not template, until indentation
  //                drops below it; leaving render ends it too.
  //   type         a `type Name =` / `interface Name` head's block body:
  //                every line at or beyond it is TYPE TEXT, until
  //                indentation drops below it.
  //   class        a block whose opening line carries CLASS (or
  //   component    COMPONENT), until indentation drops below it.
  //   import       an import (or export) statement: the contextual
  //   export       keywords `as`/`from`/`default` tag only inside one,
  //                so `from = 1` and `as = 2` stay identifiers. It
  //                survives line breaks inside brackets, so a multiline
  //                specifier list still retags the `from` after its
  //                closing brace; a new logical line outside every
  //                bracket ends it (a continuation line does not).
  //   for          FOR on the current logical line, pinned to the
  //                bracket count at the FOR so it survives newlines
  //                inside brackets opened after it (`for x in [1,\n2]`).
  //                The connector (`in`/`of`/`as`) ends it, a FOR replaces
  //                it, and a new logical line at or below its bracket
  //                count ends it.
  //   schema       a schema declaration, from its `schema` word to the
  //                end of its body: the OUTDENT that closes the body
  //                block, or for an inline body the end of its line (or
  //                an enclosing bracket's closer). Inside, the scanner
  //                emits the schema alphabet (scanSchemaToken), and the
  //                frame's tokens leave the tape as SCHEMA_BODY's payload.
  //   island       embedded Rip inside a schema body: scanned as program
  //                code until its exit rule ends it (islandExit below),
  //                then cut into one SCHEMA_CODE token of the payload.
  // Frames carry `depth` (indents.length when the frame opened; for a
  // block frame, the depth of the block it owns) and `parens`
  // (parens.length when it opened). `openModes` counts the open frames
  // of each kind, so asking whether one is open is one lookup.
  const modes = [];
  const openModes = { render: 0, 'render-code': 0, type: 0, class: 0, component: 0, import: 0, export: 0, for: 0, schema: 0, island: 0 };
  const inMode = (kind) => openModes[kind] > 0;
  const modeFrame = (kind) => {
    if (openModes[kind] === 0) return null;
    for (let k = modes.length - 1; k >= 0; k--) if (modes[k].kind === kind) return modes[k];
    return null;
  };
  const openMode = (kind) => {
    const frame = { kind, depth: indents.length, parens: parens.length };
    modes.push(frame);
    openModes[kind]++;
    return frame;
  };
  const closeMode = (k) => {
    openModes[modes[k].kind]--;
    modes.splice(k, 1);
  };
  const closeModeKind = (kind) => {
    if (openModes[kind] === 0) return;
    for (let k = modes.length - 1; k >= 0; k--) if (modes[k].kind === kind) closeMode(k);
  };
  // A block frame closes the moment indentation drops below its block.
  const closeBlocksBelow = () => {
    for (let k = modes.length - 1; k >= 0; k--) {
      const f = modes[k];
      if ((f.kind === 'render-code' || f.kind === 'type' || f.kind === 'class' || f.kind === 'component') &&
          indents.length < f.depth) closeMode(k);
    }
  };
  // Where a module line's specifier begins: after its brace, after a
  // comma, or at the head of a line inside the braces.
  const specifierStart = (prev) => prev?.kind === '{' || prev?.kind === ',' ||
    ((prev?.kind === 'INDENT' || prev?.kind === 'TERMINATOR') && parens.length > 0);
  // A word the scanner reads as anything but a name.
  const reservedSpelling = (word) => Boolean(KEYWORDS[word] && word !== 'own') ||
    RESERVED_WORDS.has(word) || STATEMENTS.has(word) || Boolean(ALIASES[word]) ||
    word === 'in' || word === 'of' || word === 'when' || word === 'import' || word === 'export';
  // The foreign side of a specifier: on an import line, the word at a
  // specifier's start with `as` after it; on an export line, the word
  // after `as`.
  const foreignModuleName = (prev, afterWord) =>
    (inMode('import') && specifierStart(prev) && /^[^\S\n]+as[^\S\n]/.test(afterWord)) ||
    (inMode('export') && prev?.kind === 'AS');
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

  // The end-state variant: the input ENDED while a delimiter was
  // still open (an unclosed bracket, an unterminated string/heredoc,
  // an open heregex), so more input can complete the program. The
  // structured fact classifyCompleteness consumes — the span still
  // points at the opener, never a pretend position at end of input.
  const failOpenAtEnd = (message, at, end = at) => {
    try {
      fail(message, at, end);
    } catch (err) {
      err.openAtEnd = true;
      throw err;
    }
  };

  const push = (kind, value, start, end, extra = {}) => {
    // Lazy FROM tagging: `from` scans as an IDENTIFIER; the module
    // source STRING that follows retags it — so `from` stays a plain
    // identifier everywhere else (`from = 1`, `x = from + as`).
    if ((kind === 'STRING' || kind === 'STRING_START') && (inMode('import') || inMode('export'))) {
      const prevTok = tokens[tokens.length - 1];
      if (prevTok?.kind === 'IDENTIFIER' && prevTok.value === 'from') prevTok.kind = 'FROM';
    }
    // `yield from` — the delegation keyword pair: `from` right after
    // YIELD is the FROM token (contextual, like the module form).
    if (kind === 'IDENTIFIER' && value === 'from' && tokens[tokens.length - 1]?.kind === 'YIELD') {
      kind = 'FROM';
    }
    // `accept name from Provider` — the same contextual FROM.
    if (kind === 'IDENTIFIER' && value === 'from' &&
        tokens[tokens.length - 1]?.kind === 'IDENTIFIER' && tokens[tokens.length - 2]?.kind === 'ACCEPT') {
      kind = 'FROM';
    }
    // Negated relations: word-`not` directly before in/of/instanceof
    // folds into ONE token (`a not in b` → RELATION '!in' → the whole
    // membership lowering negates). Word-not alone is UNARY '!'
    // (symbol `!` scans UNARY_MATH, so the pair is unambiguous).
    if (kind === 'RELATION') {
      const prevTok = tokens[tokens.length - 1];
      if (prevTok?.kind === 'UNARY' && prevTok.value === '!') {
        tokens.pop();
        value = '!' + value;
        start = prevTok.start;
      }
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
    ternary.step(kind);
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
    ternary.step(kind);
  };

  const last = () => tokens[tokens.length - 1] ?? null;

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
    if (root.kind !== 'IDENTIFIER') return false;
    const tag = String(root.value).split('#')[0];
    return TEMPLATE_TAGS.has(tag) || tag.includes('-');
  };

  // Inside render, is the scanner in code rather than template: a
  // function body, or a bracket opened within the render block (whose
  // lines continue a value, never a child list)?
  const renderCodeScope = () => inMode('render-code') || parens.length > modeFrame('render').parens;

  // Is a selector shorthand (`.class`, `#id`) possible here: markup, not a
  // handler body, a bracket group or the rest of a line after a code arrow?
  const selectorScope = () => {
    if (renderCodeScope()) return false;
    for (let k = tokens.length - 1; k >= 0; k--) {
      const kind = tokens[k].kind;
      if (kind === 'TERMINATOR' || kind === 'INDENT' || kind === 'OUTDENT' || kind === 'RENDER') break;
      if (codeArrowAt(k)) return false;
    }
    return true;
  };

  // Does tokens[k] head its template line: first on it, or first after the
  // `then`/`else` of a line an inline branch heads?
  const headsLine = (k) => {
    const before = tokens[k - 1];
    if (!before || SELECTOR_LINE_STARTS.has(before.kind)) return true;
    if (before.kind !== 'THEN' && before.kind !== 'ELSE') return false;
    let j = k - 1;
    while (j > 0 && !SELECTOR_LINE_STARTS.has(tokens[j - 1].kind)) j--;
    return SELECTOR_BRANCH_HEADS.has(tokens[j].kind);
  };

  // Where the `.`-chain ending at tokens[k] starts: its root's index, or
  // the index before the `.` of a bare line-start chain.
  const chainStartFrom = (k) => {
    const hyphen = (t) => t?.kind === '-' || (t?.kind === 'MATH' && t.value === '-');
    while (k >= 1) {
      if (tokens[k].kind === 'PROPERTY' && tokens[k - 1].kind === '.') k -= 2;
      // A class's hyphenated tail after a digit run (`p-4`, `p-4-2`,
      // `p-4-x`), which the gate joins: step over each part.
      else if ((tokens[k].kind === 'NUMBER' || tokens[k].kind === 'PROPERTY') && hyphen(tokens[k - 1]) &&
               (tokens[k - 2]?.kind === 'PROPERTY' || tokens[k - 2]?.kind === 'NUMBER')) k -= 2;
      else break;
    }
    return k;
  };

  // Does the chain starting at k head an element: a tag (or custom element)
  // that heads its template line, or a bare `.` line? Only there do the
  // selector rules hold; a chain anywhere else (a value, a loop variable
  // spelled like a tag) reads as code.
  const headSelectorAt = (k) => {
    const root = tokens[k];
    if (root?.kind === 'IDENTIFIER' && !root.generated) {
      const tag = String(root.value).split('#')[0];
      return (TEMPLATE_TAGS.has(tag) || tag.includes('-')) && headsLine(k);
    }
    return tokens[k + 1]?.kind === '.' && headsLine(k + 1);
  };

  // A selector shorthand holds a plain name; anything else is spelled as
  // the attribute, which takes any text.
  const failSelector = (kind, start) => {
    const written = /^[^\s"'`,()]+/.exec(text.slice(start))?.[0] ?? '';
    if (kind === 'class') {
      fail(`a class shorthand is letters, digits, \`-\` and \`_\` — write \`class: '${written}'\``, start - 1);
    }
    if (text[start] === '{') fail('a computed id is written as the attribute — `id: …`', start - 1);
    fail(`an id shorthand is a name starting with a letter — write \`id: '${written}'\``, start - 1);
  };

  // A render child position where a custom element's tag name may
  // stand: a line start, or the word spaced after a tag on its line
  // (`div x-icon` nests the element, as `div span` does).
  // Where a custom element's run ends, when the word just read (ending
  // at `at`) opens one: a render child position, a tight hyphen, and a
  // run that keys no pair (`aria-busy: true` stays the attribute).
  const customElementEnd = (prev, at) => {
    if (!inMode('render') || text[at] !== '-' || !IDENT_START.test(text[at + 1] ?? '') || !customElementStart(prev)) return null;
    let j = at;
    while (text[j] === '-' && IDENT_START.test(text[j + 1] ?? '')) {
      j++;
      while (j < text.length && IDENT_PART.test(text[j])) j++;
    }
    return /^:(?![=:])|^[^\S\n]+:(?![=:])[^\S\n]/.test(text.slice(j)) ? null : j;
  };

  // Is tokens[k] an arrow opening a FUNCTION body inside render? An
  // arrow straight after an element head (`div ->`, `Card ->`,
  // `div.row ->`) opens the element's children, which are template; any
  // other arrow (`@click: ->`, `(e) ->`, `f = ->`) opens code.
  const codeArrowAt = (k) => {
    const t = tokens[k];
    if (!t || (t.kind !== '->' && t.kind !== '=>')) return false;
    const before = tokens[k - 1];
    return !(t.kind === '->' && before && (before.kind === 'IDENTIFIER' || before.kind === 'PROPERTY') && !before.generated);
  };

  const customElementStart = (prev) => {
    if (renderCodeScope()) return false;
    // A function arrow earlier on the line opens a one-line code body.
    for (let k = tokens.length - 1; k >= 0; k--) {
      const kind = tokens[k].kind;
      if (kind === 'TERMINATOR' || kind === 'INDENT' || kind === 'OUTDENT' || kind === 'RENDER') break;
      if (codeArrowAt(k)) return false;
    }
    if (prev?.kind === 'INDENT') {
      // An indent after `title:` or `x =` continues that value, and so
      // does a block opened on a render-local line (`x = if ok`).
      const before = tokens[tokens.length - 2]?.kind;
      if (before === ':' || before === '=' || before === 'COMPOUND_ASSIGN' || before === ',') return false;
      let k = tokens.length - 2;
      while (k > 0 && !['TERMINATOR', 'INDENT', 'OUTDENT', 'RENDER'].includes(tokens[k - 1].kind)) k--;
      return !(tokens[k]?.kind === 'IDENTIFIER' && tokens[k + 1]?.kind === '=');
    }
    // A line start. An inline branch's custom element (`if x then
    // x-icon`) is the template gate's to join (src/render.js), since only
    // it knows whether the branch is markup or a value.
    if (!prev || prev.kind === 'TERMINATOR' || prev.kind === 'OUTDENT' || prev.kind === 'RENDER') return true;
    if (!pendingSpaced || prev.generated) return false;
    let j = tokens.length - 1;
    while (j >= 1 && tokens[j].kind === 'PROPERTY' && tokens[j - 1].kind === '.') j -= 2;
    const root = tokens[j];
    if (j < tokens.length - 1 && (!root || root.kind === 'INDENT' || root.kind === 'TERMINATOR' || root.kind === 'OUTDENT' || root.kind === 'RENDER')) return true;
    if (root?.kind !== 'IDENTIFIER') return false;
    const tag = String(root.value).split('#')[0];
    return TEMPLATE_TAGS.has(tag) || tag.includes('-');
  };

  // Open the class and component frames of a block about to open: its
  // opening line (the tokens since the line's last TERMINATOR, INDENT or
  // OUTDENT) carries CLASS, COMPONENT, or both. Returns the body the block
  // is — the line's last CLASS or COMPONENT, unless a `then` after it
  // already took the body inline — which `bodyKinds` records for the
  // block's INDENT.
  const openBodyModes = () => {
    let cls = false, cmp = false, body = null;
    for (let j = tokens.length - 1; j >= 0; j--) {
      const h = tokens[j].kind;
      if (h === 'TERMINATOR' || h === 'INDENT' || h === 'OUTDENT') break;
      if (h === 'THEN' && body === null) body = false;
      if (h === 'CLASS') cls = true;
      else if (h === 'COMPONENT') cmp = true;
      if (body === null && (h === 'CLASS' || h === 'COMPONENT')) body = h === 'CLASS' ? 'class' : 'component';
    }
    if (cls) openMode('class');
    if (cmp) openMode('component');
    return body || false;
  };

  // Context-sensitive `offer`/`accept`: keywords only lexically inside a
  // component body, at any depth. A component frame lives exactly as long
  // as its block, so a component closed earlier in the file never turns
  // later words into keywords; the opening line is scanned for COMPONENT
  // wherever it sits, so the extends form (`… = component extends
  // button` + INDENT) opens one like the plain form.
  const insideComponentBody = () => inMode('component');

  // Is the scanner inside a CLASS body — directly, not in a block
  // nested under one? The innermost open block decides: it is a class
  // body when the line that opened it carries CLASS. A method's body, a
  // field's indented value, and every deeper block answer no.
  const insideClassBody = () => modeFrame('class')?.depth === indents.length;

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
    if (pos >= text.length) failOpenAtEnd('unterminated string', opener);
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
    if (pos >= text.length) failOpenAtEnd('unterminated string', ctx.opener);

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
    // The closer's own line, read backwards from the closer: any of LF,
    // CRLF or a lone CR opens a line, so the nearer of the two searches
    // is the boundary. Reading the line directly keeps this proportional
    // to that line — a heredoc late in a file does not re-walk every
    // byte before it.
    const lineFrom = closer.start - 1;
    const lineBreak = lineFrom < 0 ? -1
      : Math.max(text.lastIndexOf('\n', lineFrom), text.lastIndexOf('\r', lineFrom));
    const closerLine = text.slice(lineBreak + 1, closer.start);
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
    if (!text.startsWith('///', pos)) {
      // The chunk scan stops only at the closer, an interpolation, or
      // end of input — reaching here without the closer IS end of
      // input, so continuation input can still close the literal.
      failOpenAtEnd('missing /// (unclosed heregex)', ctx.opener);
    }
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

  // Inside a type body (the `type` mode frame): the O(1) answer
  // closesTypeGeneric needs for trailing generic closes,
  // wrapped-across-lines generics included.
  // The closesTypeGeneric incremental state for this run (one map
  // lookup per trailing-angle line; every token processed once).
  const typeGenericMemo = { upTo: 0, ref: null, level: 0, answers: new Map() };
  const insideTypeBody = () => {
    const frame = modeFrame('type');
    return frame !== null && indents.length >= frame.depth;
  };

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

  // ── Template-literal types ─────────────────────────────────────────
  // A backticked TYPE (`` `${number}${Unit}` ``) is scanned whole and
  // pushed as ONE opaque token. The declaration re-slices its text
  // from source, so the interior never needs tokens of its own — and
  // keeping it unsplit is what stops a `>` or `{` inside a chunk from
  // reaching the angle-balance and brace scanners that read the tape.
  // Each of the three returns the offset PAST the construct it scans.
  // The literal stays on one line: consuming a newline here would
  // carry the scan past an indentation boundary the indent stack
  // never sees, and `insideTypeBody` reads that stack.
  // A line break ends every one of these scans, and an ESCAPE can
  // never swallow it: `i += 2` stepping over a newline would carry the
  // literal onto the next line, where a stray backtick closes it and
  // takes a whole statement into the erased type with it.
  const lineBreakAt = (j) => text[j] === '\n' || text[j] === '\r';

  const scanTypeTemplateEnd = (start) => {
    let i = start + 1;
    while (i < text.length) {
      const c = text[i];
      if (lineBreakAt(i) || (c === '\\' && lineBreakAt(i + 1))) {
        fail('a template-literal type stays on one line', start, i);
      }
      if (c === '\\') { i += 2; continue; }
      if (c === '`') return i + 1;
      if (c === '$' && text[i + 1] === '{') { i = scanTypeInterpEnd(i + 2); continue; }
      i++;
    }
    failOpenAtEnd("unclosed '`' — the template-literal type never closes", start, start + 1);
  };

  // One `${…}` interpolation: ends past the brace matching its opener.
  // Quoted strings and nested template literals are skipped whole, so
  // a brace inside either never counts toward the depth.
  const scanTypeInterpEnd = (start) => {
    let i = start, depth = 1;
    while (i < text.length) {
      const c = text[i];
      if (lineBreakAt(i) || (c === '\\' && lineBreakAt(i + 1))) {
        fail('a template-literal type stays on one line', start - 2, i);
      }
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i = scanTypeTemplateEnd(i); continue; }
      if (c === '"' || c === "'") { i = scanTypeQuoteEnd(i); continue; }
      if (c === '{') { depth++; i++; continue; }
      if (c === '}') { if (--depth === 0) return i + 1; i++; continue; }
      i++;
    }
    failOpenAtEnd("unclosed '${' — the interpolation never closes", start - 2, start);
  };

  const scanTypeQuoteEnd = (start) => {
    const quote = text[start];
    let i = start + 1;
    while (i < text.length) {
      if (lineBreakAt(i) || (text[i] === '\\' && lineBreakAt(i + 1))) break;
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === quote) return i + 1;
      i++;
    }
    fail('unterminated string', start, start + 1);
  };

  const closeBracket = () => {
    // An island opened inside this bracket ends before its closer.
    for (let t = dslTop(); t?.kind === 'island' && t.exit !== 'params' && t.parens >= parens.length; t = dslTop()) closeIsland(t);
    const frame = parens.pop();
    if (!frame) return null;
    while (tokens.length && tokens[tokens.length - 1].kind === 'TERMINATOR') tokens.pop();
    const blockEnd = lastRealEnd();
    while (indents.length > frame.depth) popIndent(blockEnd);
    closeBlocksBelow();
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
      popIndent(blockEnd);
    }
    closeBlocksBelow();
    if (indents[indents.length - 1] !== prefix) {
      fail(
        `inconsistent indentation: ${JSON.stringify(prefix)} neither extends the ` +
        `enclosing block's ${JSON.stringify(indents[indents.length - 1])} nor matches any open block${hint}`,
        lineStart,
      );
    }
  };

  // ── Schema mode ──────────────────────────────────────────────────────
  // A schema declaration's body is its own small language, so the scanner
  // reads it in the schema alphabet rather than as program code: every
  // word is S_WORD (no keyword lookup, so a field may be named `else` or
  // `class`), a `:word` is S_SYMBOL, a tight `!`/`?` after a name is a
  // modifier, `[]` is S_ARRAY, `@ensure`/`@scope`/`@defaultScope` have
  // terminals of their own and every other `@word` is S_DIRECTIVE. The
  // frame's tokens leave the tape at its close and become SCHEMA_BODY's
  // payload, which the grammar's SchemaBody entry parses; src/schema.js
  // fills SCHEMA_BODY's value (the descriptor) from that tree.
  //
  // Embedded Rip — a callable, scope or @ensure body, a field transform,
  // the `on:` adapter — is an island: scanned as program code from the
  // token after its arrow until its exit rule, then cut into one
  // SCHEMA_CODE token whose payload is the island run through every pass.
  // Each island kind has one written exit (islandExit), and each ends
  // before the token that ends it:
  //   line     callables and scopes: the line's end at the island's own
  //            depth (a block body belongs to it), or a `;`;
  //   part     a field transform or an inline @ensure predicate: the
  //            line's end, or a comma at the island's own depth and
  //            bracket level — `-> f a, b` ends at the comma, and the
  //            trailer after it is the reader's to judge;
  //   element  a predicate inside `@ensure […]`: a comma, a line end, or
  //            the bracket's closer;
  //   head     the `on:` adapter: the head line's end or its `;`;
  //   params   a `(…)` parameter list: its matching `)`. Its tokens become
  //            one S_PARAMS token, read at emission (paramsOf).
  // Positions where `schema` may begin an expression — the opener set,
  // gated against the parse table by test/schema/schema.test.js.
  const schemaState = { defaultMaxString: null };
  // The INDENTs that open a class or component body, by token id (ids
  // survive the copies a schema island's passes run over): rewriteTypes
  // claims typed fields only directly inside one.
  const bodyKinds = new Map();
  // The ids of `else`, `catch` and `finally` tokens that open a line at
  // an island's own depth.
  const islandLineKeywords = new Set();
  const islands = [];
  const payloads = new Map();
  const dslTop = () => {
    if (openModes.schema === 0) return null;
    for (let k = modes.length - 1; k >= 0; k--) {
      if (modes[k].kind === 'schema' || modes[k].kind === 'island') return modes[k];
    }
    return null;
  };
  const inDsl = () => dslTop()?.kind === 'schema';
  // Close a frame and every frame opened above it.
  const closeFrom = (f) => {
    const k = modes.indexOf(f);
    while (modes.length > k) closeMode(modes.length - 1);
  };

  const openIsland = (exit, at = pos) => {
    const s = dslTop();
    const f = openMode('island');
    f.exit = exit;
    f.tapeAt = tokens.length;
    f.schema = s;
    f.at = at;
    f.entryStart = s.lineStart ?? at;
    return f;
  };
  const closeIsland = (f) => {
    const raw = tokens.splice(f.tapeAt);
    closeFrom(f);
    const start = raw.length ? raw[0].start : f.entryStart;
    const end = raw.length ? raw[raw.length - 1].end : start;
    const code = {
      id: nextId++, kind: 'SCHEMA_CODE', value: text.slice(start, end), start, end,
      spaced: true, newLine: false, generated: false, origin: null,
    };
    tokens.push(code);
    f.schema.islands.set(start, raw);
    islands.push({ code, raw });
  };
  const closeParams = (f, end) => {
    const raw = tokens.splice(f.tapeAt);
    closeFrom(f);
    const start = raw[0].start;
    f.schema.params.set(start, raw.slice(1));
    tokens.push({
      id: nextId++, kind: 'S_PARAMS', value: text.slice(start, end), start, end,
      spaced: raw[0].spaced, newLine: false, generated: false, origin: null,
    });
  };

  // The identifier-named words a schema region carries, as the parser's
  // primitive occurrences: SCHEMA_BODY collapses the region into one
  // token, and these spans let the generated parser keep each word's
  // identity through it. A symbol, kind or directive token's word starts
  // after its sigil.
  const schemaPrimitives = (payload, f) => {
    const out = [];
    const add = (value, sourceStart, sourceEnd) => {
      if (typeof value === 'string' && isIdentifierName(value)) out.push({ value, sourceStart, sourceEnd });
    };
    const walk = (list) => {
      for (const t of list) {
        switch (t.kind) {
          case 'SCHEMA_CODE': walk(f.islands.get(t.start) ?? []); break;
          case 'S_PARAMS': walk(f.params.get(t.start) ?? []); break;
          case 'SCHEMA_BODY': out.push(...t.value.primitiveSpans); break;
          case 'S_KIND': case 'S_SYMBOL': case 'SYMBOL': case 'S_DIRECTIVE':
          case 'S_ENSURE': case 'S_SCOPE': case 'S_DEFAULT_SCOPE':
            add(t.value, t.start + 1, t.end); break;
          default: if (!t.generated) add(t.value, t.start, t.end);
        }
      }
    };
    // The header's adapter is no part of the body: its words belong to
    // its own island's tree.
    const body = payload.findIndex((t) => t.kind === 'INDENT' || t.kind === 'TERMINATOR');
    walk(payload[0]?.kind === 'S_KIND' ? [payload[0], ...payload.slice(body)] : payload.slice(body));
    out.push(...f.droppedWords);
    return out.sort((a, b) => a.sourceStart - b.sourceStart);
  };

  const openSchema = (start, end) => {
    push('SCHEMA', 'schema', start, end);
    const f = openMode('schema');
    f.tapeAt = tokens.length;
    f.start = start;
    f.bodyDepth = null;
    f.inline = false;
    f.markerAt = -1;
    f.lineStart = null;
    f.lineHead = null;
    f.lines = 0;
    f.kindText = null;
    f.enumByFirstLine = false;
    f.droppedWords = [];
    f.islands = new Map();
    f.params = new Map();
    f.defaultMaxString = schemaState.defaultMaxString;
  };
  const closeSchema = (f) => {
    const payload = tokens.splice(f.tapeAt);
    closeFrom(f);
    const kindTok = payload[0]?.kind === 'S_KIND' ? payload[0] : null;
    if (f.bodyDepth === null && !f.inline) {
      fail(`expected an indented schema body (or an inline '; field; …' body) after 'schema${kindTok ? ' :' + kindTok.value : ''}'`, f.start);
    }
    let first, last;
    if (f.inline) {
      const marker = f.markerAt - f.tapeAt;
      while (payload.length - 1 > marker && payload[payload.length - 1].kind === 'TERMINATOR') payload.pop();
      if (payload.length - 1 === marker) {
        fail(`inline schema body is empty — add '; field; …' entries or switch to the indented form`, f.start);
      }
      first = payload[marker + 1];
      last = payload[payload.length - 1];
    } else {
      // A trailing `;` (or a dropped line) leaves a separator before the
      // body's closing OUTDENT; it separates nothing.
      while (payload.length > 1 && payload[payload.length - 2].kind === 'TERMINATOR') payload.splice(payload.length - 2, 1);
      const indentAt = payload.findIndex((t) => t.kind === 'INDENT');
      first = payload[indentAt + 1];
      last = payload[payload.length - 2];
      // A tolerant scan that dropped every line leaves an empty body,
      // which starts where its first dropped line did.
      if (last === payload[indentAt]) {
        first = { start: f.droppedAt ?? payload[indentAt].start };
        last = { end: payload[indentAt].end };
      }
    }
    const start = (kindTok ?? first).start;
    let end = Math.max(start, f.droppedEnd ?? 0);
    for (const t of payload) if (!t.generated && t.end > end) end = t.end;
    if (!f.inline && last.end > end) end = last.end;
    const descriptor = {
      kind: null,
      entries: [],
      toJSON() { return this.kind; },
      start,
      end,
      primitiveSpans: schemaPrimitives(payload, f),
    };
    Object.defineProperty(descriptor, SCHEMA_SCAN, {
      value: { islands: f.islands, params: f.params, defaultMaxString: f.defaultMaxString, schemaStart: f.start },
    });
    const body = {
      id: nextId++, kind: 'SCHEMA_BODY', value: descriptor, start, end,
      spaced: true, newLine: false, generated: false, origin: null,
    };
    tokens.push(body);
    payloads.set(body, payload);
  };

  // Indentation drops one level: islands and inline bodies opened at the
  // level it leaves end before the OUTDENT; a block body the drop leaves
  // ends with it.
  const popIndent = (at) => {
    for (let t = dslTop(); t !== null && t.depth >= indents.length; t = dslTop()) {
      if (t.kind === 'island' && t.exit !== 'params') closeIsland(t);
      else if (t.kind === 'schema' && t.bodyDepth === null) closeSchema(t);
      else break;
    }
    indents.pop();
    synth('OUTDENT', at);
    const t = dslTop();
    if (t?.kind === 'schema' && t.bodyDepth !== null && t.bodyDepth > indents.length) closeSchema(t);
  };

  // A statement separator: islands it ends close first. In a schema
  // header a `;` opens the inline body; inside a body, separators never
  // double and never follow an INDENT (a body has no empty lines).
  const pushTerminator = (value, start, end, extra = {}) => {
    for (let t = dslTop(); t?.kind === 'island' && t.exit !== 'params' && indents.length <= t.depth && parens.length <= t.parens; t = dslTop()) closeIsland(t);
    const s = dslTop();
    if (s?.kind === 'schema') {
      if (s.bodyDepth === null && !s.inline) {
        if (value === ';' && parens.length === s.parens) {
          s.inline = true;
          s.markerAt = tokens.length;
          push('TERMINATOR', value, start, end, extra);
        }
        return;
      }
      const k = last()?.kind;
      if (k === 'TERMINATOR' || k === 'INDENT') return;
    }
    push('TERMINATOR', value, start, end, extra);
  };

  // A comma ends a part or element island at its own depth and level.
  const commaEndsIsland = () => {
    const t = dslTop();
    if (t?.kind === 'island' && (t.exit === 'part' || t.exit === 'element') &&
        indents.length === t.depth && parens.length === t.parens) closeIsland(t);
  };

  // A new logical line: it ends an inline body and the head line's
  // adapter; a header that reaches it without opening a body rejects.
  const schemaLineStart = (deeper) => {
    for (let t = dslTop(); t !== null; t = dslTop()) {
      if (t.kind === 'island' && t.exit === 'head') { closeIsland(t); continue; }
      if (t.kind === 'schema' && t.inline && parens.length <= t.parens) {
        // An inline body ends at its line's end, so a trailing `;` there
        // continues nothing — inside a bracket the line break would split
        // the body from what follows, silently.
        if (parens.length > 0 && last()?.kind === 'TERMINATOR' && last().value === ';' && tokens.length - 1 > t.markerAt) {
          fail(`an inline schema body ends at its line's end — a trailing ';' cannot continue it inside a bracket; use the indented form`, last().start, last().end);
        }
        closeSchema(t);
        continue;
      }
      if (t.kind === 'schema' && t.bodyDepth === null && !t.inline && !deeper) { closeSchema(t); continue; }
      return;
    }
  };

  // Does the next code line (past blank and comment lines) indent past
  // the current block?
  const nextLineDeeper = (from) => {
    const cur = indents[indents.length - 1];
    let k = text.indexOf('\n', from);
    while (k >= 0) {
      const a = k + 1;
      let b = a;
      while (text[b] === ' ' || text[b] === '\t') b++;
      if (b >= text.length) return false;
      if (text[b] === '\n' || text[b] === '\r' || text[b] === '#') { k = text.indexOf('\n', b); continue; }
      // A line opening with a member `.`/`?.` continues the line above
      // (the layout rule), so it is no body.
      const dot = text[b] === '?' && text[b + 1] === '.' ? b + 1 : text[b] === '.' ? b : -1;
      if (dot >= 0 && text[dot + 1] !== '.' && !DIGIT.test(text[dot + 1] ?? '')) return false;
      const prefix = text.slice(a, b);
      return prefix.length > cur.length && prefix.startsWith(cur);
    }
    return false;
  };

  // Does the `schema` word just scanned (ending at pos) open a schema?
  // A kind marker (`schema :shape`, the colon spaced, the word tight)
  // always does where a value may start — after an opener-set token, or
  // as an implicit call's argument (`validate schema :shape`). Without a
  // kind it needs a body: a `;`, or a deeper next line.
  const schemaOpens = (prev, spaced) => {
    let j = pos;
    while (text[j] === ' ' || text[j] === '\t') j++;
    if (j > pos && text[j] === ':' && IDENT_START.test(text[j + 1] ?? '')) {
      return prev === null || SCHEMA_OPENERS.has(prev.kind) ||
        (spaced && (prev.kind === 'IDENTIFIER' || prev.kind === 'PROPERTY') && !prev.generated);
    }
    if (prev !== null && !SCHEMA_BARE_OPENERS.has(prev.kind)) return false;
    if (text[j] === ';') return true;
    if (j < text.length && text[j] !== '\n' && text[j] !== '\r' && text[j] !== '#') return false;
    return nextLineDeeper(j);
  };

  // `schema.<key> = <number>` at file top level: a statement the scanner
  // consumes; its value applies to every later schema in the file.
  const scanSchemaPragma = (m) => {
    const { key } = m;
    const keyStart = pos + 1;
    if (!SCHEMA_PRAGMA_KEYS.has(key)) {
      fail(`unknown schema pragma 'schema.${key}' — known pragmas: ${[...SCHEMA_PRAGMA_KEYS].join(', ')}`, keyStart);
    }
    if (indents.length > 1 || dslTop() !== null) {
      fail(`schema pragma 'schema.${key}' must be declared at file top level — inside a nested block it would leak into later top-level schemas`, keyStart);
    }
    let v = pos + m.length;
    while (text[v] === ' ' || text[v] === '\t') v++;
    const nm = DIGIT.test(text[v] ?? '') || (text[v] === '.' && DIGIT.test(text[v + 1] ?? '')) ? NUMBER_RE.exec(text.slice(v)) : null;
    if (nm === null) {
      fail(`pragma 'schema.${key}' requires a number literal — example: schema.${key} = 100`, v < text.length && text[v] !== '\n' && text[v] !== '\r' ? v : keyStart);
    }
    const raw = nm[0];
    const digits = raw.replace(/_/g, '');
    if (digits.endsWith('n')) fail(`pragma 'schema.${key}' cannot be a BigInt (${raw}) — schema values are JSON numbers`, v);
    const n = Number(digits);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      fail(`pragma 'schema.${key}' expects a non-negative integer (got ${raw}); use 0 to disable`, v);
    }
    schemaState[key] = n === 0 ? null : n;
    pos = v + raw.length;
  };

  // A rejected `name:` line head. Tolerant scans keep the rest of the
  // schema: the line is the repair unit, recorded and dropped, so a
  // half-typed member (`greet: `, the keystrokes before its arrow)
  // never takes the schema's face with it.
  const rejectSchemaLine = (message, at, from) => {
    if (!tolerant) fail(message, at);
    lexDiagnostics.push({ message, start: at, end: at, expected: [], got: '' });
    const f = dslTop();
    const lineStart = tokens[from]?.start ?? at;
    f.droppedAt ??= lineStart;
    while (tokens.length > from) tokens.pop();
    while (pos < text.length && text[pos] !== '\n' && text[pos] !== '\r') pos++;
    let end = pos;
    while (end > at && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
    f.droppedEnd = end;
    // The dropped line's words stay the schema's primitive occurrences,
    // as every word of its region is.
    for (const m of identifierMatches(text.slice(lineStart, end))) {
      f.droppedWords.push({ value: m[0], sourceStart: lineStart + m.index, sourceEnd: lineStart + m.index + m[0].length });
    }
    pendingSpaced = false;
  };

  // An arrow inside a body opens its island; an inline body holds none.
  const schemaArrow = (f, kind, glyph) => {
    if (f.inline && parens.length === f.parens) {
      fail(glyph === '->'
        ? `inline schema bodies do not support '->' (methods/hooks/scopes/transforms) — use the indented form`
        : `inline schema bodies do not support '${glyph}' (${glyph === '~>' ? 'computed getters' : 'eager-derived fields'}) — use the indented form`, pos);
    }
    push(kind, glyph, pos, pos + 2);
    pos += 2;
    const exit = kind !== '->' ? 'line'
      : parens.length > f.parens ? 'element'
      : f.lineHead === 'field' || f.lineHead === 'ensure' ? 'part'
      : 'line';
    openIsland(exit);
  };

  // One token of a schema body, in the schema alphabet. Returns false to
  // hand the character to the program scanner: numbers, plain strings,
  // and a closer that belongs to an enclosing bracket.
  const scanSchemaToken = (ch) => {
    const f = dslTop();
    const prev = last();
    const header = f.bodyDepth === null && !f.inline;
    const atHead = !header && parens.length === f.parens && tokens.length > f.tapeAt &&
      (prev.kind === 'TERMINATOR' || (prev.kind === 'INDENT' && indents.length === f.bodyDepth));
    if (atHead) {
      f.lineStart = pos;
      f.lineHead = null;
      f.lines++;
    }
    const tight = !pendingSpaced;
    const one = (kind, value = ch) => {
      push(kind, value, pos, pos + value.length);
      pos += value.length;
      return true;
    };
    if (IDENT_START.test(ch)) {
      const start = pos;
      while (pos < text.length && IDENT_PART.test(text[pos])) pos++;
      const word = text.slice(start, pos);
      if (header && prev?.kind === ',' && word === 'on') {
        push('S_ON', word, start, pos);
        let j = pos;
        while (text[j] === ' ' || text[j] === '\t') j++;
        if (text[j] === ':' && text[j + 1] !== ':') pos = j + 1;
        openIsland('head');
        return true;
      }
      if (atHead) {
        // `name:` heads a callable line: its parameters or arrow follow.
        let j = pos;
        while (text[j] === ' ' || text[j] === '\t') j++;
        const keyColon = text[j] === ':' && text[j + 1] !== ':' && text[j + 1] !== '=' &&
          (j === pos || !IDENT_START.test(text[j + 1] ?? ''));
        if (keyColon) {
          f.lineHead = 'callable';
          const from = tokens.length;
          // An :enum or :union body has no members of that shape (and no
          // half-typed member for a tolerant scan to drop).
          if (f.kindText === 'enum' || f.enumByFirstLine) {
            fail(`enum member must be a :symbol — use ':${word}' for a bare member or ':${word} value' for a valued one`, start);
          }
          if (f.kindText === 'union') {
            fail(`:union bodies accept only '@on :field' and bare constituent schema names (one per line) — got PROPERTY followed by :`, start);
          }
          push('S_WORD', word, start, pos);
          pendingSpaced = j > pos;
          push(':', ':', j, j + 1);
          pos = j + 1;
          let k = pos;
          while (text[k] === ' ' || text[k] === '\t') k++;
          const two = text.slice(k, k + 2);
          if (text[k] === '(' || two === '->' || two === '~>' || two === '!>') return true;
          const wordish = IDENT_START.test(text[k] ?? '') || text[k] === '"' || text[k] === "'" || DIGIT.test(text[k] ?? '');
          rejectSchemaLine(wordish
            ? `schema fields use 'name type' (space, no colon) — got '${word}:'; for methods/computed use 'name: -> body' or 'name: ~> body'`
            : `schema top-level '${word}:' must be followed by '->' (method), '~>' (computed getter), or '!>' (eager derived)`, j, from);
          return true;
        }
        f.lineHead = 'field';
      }
      push('S_WORD', word, start, pos);
      return true;
    }
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[pos + 1] ?? ''))) return false;
    switch (ch) {
      case ':': {
        if (IDENT_START.test(text[pos + 1] ?? '') && !(tight && prev?.kind === 'S_WORD')) {
          const end = symbolNameEnd(text, pos + 1);
          const kind = header && tokens.length === f.tapeAt ? 'S_KIND' : 'S_SYMBOL';
          if (kind === 'S_KIND') f.kindText = text.slice(pos + 1, end);
          if (atHead) f.lineHead = 'member';
          // A kindless body whose first line is a :symbol is an :enum.
          if (atHead && f.lines === 1 && f.kindText === null) f.enumByFirstLine = true;
          push(kind, text.slice(pos + 1, end), pos, end);
          pos = end;
          return true;
        }
        return one(':');
      }
      case '!':
        if (text[pos + 1] === '>') { schemaArrow(f, '!>', '!>'); return true; }
        if (tight && (prev?.kind === 'S_WORD' || prev?.kind === 'S_BANG' || prev?.kind === 'S_OPT' || prev?.kind === 'S_ENSURE')) return one('S_BANG');
        fail(`'!' in a schema body is a modifier, written right after its name ('name!', '@ensure!')`, pos);
        break;
      case '?':
        if (tight && (prev?.kind === 'S_WORD' || prev?.kind === 'S_BANG' || prev?.kind === 'S_OPT')) return one('S_OPT');
        fail(`'?' in a schema body is a modifier, written right after its name ('name?', 'User?')`, pos);
        break;
      case '~':
        if (text[pos + 1] === '>') { schemaArrow(f, 'EFFECT', '~>'); return true; }
        return one('S_TILDE');
      case '-':
        if (text[pos + 1] === '>') { schemaArrow(f, '->', '->'); return true; }
        return one('-');
      case '=':
        if (text[pos + 1] === '>') return one('=>', '=>');
        break;
      case '.':
        if (text[pos + 1] === '.') return one(text[pos + 2] === '.' ? '...' : '..', text[pos + 2] === '.' ? '...' : '..');
        return one('.');
      case '@': {
        if (!IDENT_START.test(text[pos + 1] ?? '')) fail(`expected a directive name after '@'`, pos);
        let end = pos + 1;
        while (end < text.length && IDENT_PART.test(text[end])) end++;
        const name = text.slice(pos + 1, end);
        const kind = name === 'ensure' ? 'S_ENSURE' : name === 'scope' ? 'S_SCOPE' : name === 'defaultScope' ? 'S_DEFAULT_SCOPE' : 'S_DIRECTIVE';
        if (atHead) f.lineHead = kind === 'S_ENSURE' ? 'ensure' : kind === 'S_DIRECTIVE' ? 'directive' : 'scope';
        push(kind, name, pos, end);
        pos = end;
        return true;
      }
      case '[': {
        let j = pos + 1;
        while (text[j] === ' ' || text[j] === '\t') j++;
        if (text[j] === ']') {
          push('S_ARRAY', '[]', pos, j + 1);
          pos = j + 1;
          return true;
        }
        openBracket('array', pos);
        return one('[');
      }
      case '{':
        openBracket('object', pos);
        return one('{');
      case '(': {
        // A parameter list is program code up to its matching `)`.
        openBracket('group', pos);
        openIsland('params');
        return one('(');
      }
      case ']': case '}': case ')':
        // A closer of a bracket opened before the schema ends an inline
        // body; the program scanner then reads it.
        if (parens.length <= f.parens && f.inline) closeSchema(f);
        return false;
      case ',':
        return one(',');
      case ';':
        pushTerminator(';', pos, pos + 1);
        pos++;
        return true;
      case '|':
        return one('|');
      case '"': case "'": {
        if (text.startsWith(ch.repeat(3), pos)) {
          fail(`schema values are plain string literals — a heredoc has no literal form here`, pos, pos + 3);
        }
        if (ch === '"') {
          for (let k = pos + 1; k < text.length && text[k] !== '"' && text[k] !== '\n'; k++) {
            if (text[k] === '\\') { k++; continue; }
            if (text[k] === '#' && text[k + 1] === '{') {
              fail(`schema values are plain string literals — an interpolation has no literal form here`, k, k + 2);
            }
          }
        }
        return false;
      }
      case '/': {
        const m = REGEX_RE.exec(text.slice(pos));
        if (!m || !m[2]) fail('missing / (unclosed regex)', pos);
        const flags = REGEX_FLAGS_RE.exec(text.slice(pos + m[0].length))[0];
        if (!VALID_FLAGS_RE.test(flags)) fail(`invalid regular expression flags ${flags}`, pos);
        const end = pos + m[0].length + flags.length;
        push('REGEX', `/${m[1]}/${flags}`, pos, end);
        pos = end;
        return true;
      }
    }
    fail(`unexpected '${ch}' in a schema body`, pos);
  };

  while (pos < text.length) {
    if (counter.on) counter.n++;
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
      // A line that is exactly `__DATA__` ends the program, and the
      // scanner reads no further: everything after the marker line is
      // the __DATA__ section, raw text. The program scans as if the file
      // ended before the marker line. The marker is seen only where a
      // line starts, so a `__DATA__` line inside a string or block
      // comment is that token's text. The section is its lines as
      // written: the file's own final newline ends the file, not the
      // text.
      if (prefix === '' && text.startsWith('__DATA__', pos)) {
        const after = pos + 8;
        const eol = after === text.length ? 0 : text[after] === '\n' ? 1 : text[after] === '\r' && text[after + 1] === '\n' ? 2 : -1;
        if (eol >= 0) {
          const rest = text.slice(after + eol);
          const final = rest.endsWith('\r\n') ? 2 : rest.endsWith('\n') ? 1 : 0;
          data = { start: lineStart, text: rest.slice(0, rest.length - final) };
          const lineEnd = text[lineStart - 2] === '\r' ? 2 : lineStart > 0 ? 1 : 0;
          text = text.slice(0, lineStart - lineEnd);
          break;
        }
      }
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
      const renderIdLine = inMode('render') && text[pos] === '#' && IDENT_START.test(text[pos + 1] ?? '') &&
        prefix.length > (indents[modeFrame('render').depth - 1] ?? '').length;
      if (text[pos] === '#' && !renderIdLine) {
        let end = pos;
        // A `###` line (three hashes then anything but a fourth) opens
        // a BLOCK comment that runs to the next `###`, however many
        // lines away, and only whitespace or a line comment may follow
        // the closer on its line — code there would be swallowed
        // silently, and a comment must never swallow code. An unclosed
        // block rejects at its opener, like an unterminated heredoc
        // (`__DATA__` is the spelling for "the rest is not code").
        // `####…` is a line comment like any other.
        if (text.startsWith('###', pos) && text[pos + 3] !== '#') {
          const close = text.indexOf('###', pos + 3);
          if (close < 0) failOpenAtEnd('unclosed `###` block comment — close it with `###`', pos, pos + 3);
          end = close + 3;
          let after = end;
          while (text[after] === ' ' || text[after] === '\t') after++;
          if (after < text.length && text[after] !== '\n' && text[after] !== '\r' && text[after] !== '#') {
            fail('code after a closing `###` — a block comment ends its line; put the code on the next line', close, end);
          }
        }
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
      const current = indents[indents.length - 1];
      const prev = last();
      // A DANGLING member dot. A trailing '.' leaves its line unfinished,
      // which is what a member chain wrapped across lines needs — but the
      // same spelling is what stands there the instant a member access is
      // typed above another construct, and continuing swallows that
      // construct into the chain (`foo.` above `export y = 1` reads as
      // `foo.export(y = 1)`). The discriminator is TypeScript's: past the
      // line break, a word followed by ANOTHER word on the same line opens
      // a new construct, never a property. A word followed by anything
      // else — '(', '.', a literal — is still a property, so a chain
      // whose next line calls or reaches on continues to continue.
      //
      // Rip needs one guard TypeScript does not, because here `bar baz` IS
      // a property call — implicit parens make two words a call, so that
      // test alone would break every wrapped chain ending in one. A real
      // continuation indents past the statement it continues, so only a
      // line at or above the current indent can dangle.
      const danglingDot = () => {
        if (prev == null || (prev.kind !== '.' && prev.kind !== '?.')) return false;
        // Inside brackets indentation carries nothing — a continuation
        // there needs no indent, so the guard below cannot tell one from
        // a new construct, and a bracket is not where a construct begins.
        if (parens.length > 0) return false;
        // Render blocks read a line-leading identifier as an ELEMENT, so
        // two words at the same indent are a sibling element and its
        // argument, not a new construct — the same reason the leading-dot
        // rule below excludes them. What a trailing dot means there is
        // the render grammar's to say, and it is not saying it here —
        // except a `.` alone on its line, which is an element (an implicit
        // `div`), so its line ends there.
        if (inMode('render')) {
          const before = tokens[tokens.length - 2];
          return !before || before.kind === 'INDENT' || before.kind === 'OUTDENT' ||
            before.kind === 'TERMINATOR' || before.kind === 'RENDER';
        }
        if (prefix.length > current.length) return false;
        if (!IDENT_START.test(text[pos] ?? '')) return false;
        let at = pos;
        while (at < text.length && IDENT_PART.test(text[at])) at++;
        while (text[at] === ' ' || text[at] === '\t') at++;
        return IDENT_START.test(text[at] ?? '');
      };
      const prevUnfinished = prev != null && UNFINISHED.has(prev.kind)
        && !closesTypeGeneric(tokens, insideTypeBody(), typeGenericMemo)
        && !danglingDot();
      const commaCont = text[pos] === ',';
      const dotAt = text[pos] === '?' && text[pos + 1] === '.' ? pos + 1 : (text[pos] === '.' ? pos : -1);
      // Inside render blocks a line-leading '.' is a NEW element
      // (`.card` — implicit-div class selector), never a member-chain
      // continuation.
      const dotCont = dotAt >= 0 && text[dotAt + 1] !== '.' && !DIGIT.test(text[dotAt + 1] ?? '') && !inMode('render');
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

      const deeper = prefix !== current && prefix.startsWith(current);
      if (openModes.schema > 0) schemaLineStart(deeper);
      if (deeper) {
        // The block may open a mode: a type-body head's block is type
        // text (nested layout indents inherit through the depth
        // comparison), a code arrow's block inside render is code, and
        // a class or component line's block is that body.
        const opensType = !inMode('type') && typeBodyHead();
        const opensCode = inMode('render') && !inMode('render-code') && codeArrowAt(tokens.length - 1);
        indents.push(prefix);
        if (opensType) openMode('type');
        if (opensCode) openMode('render-code');
        const body = openBodyModes();
        // Anchor at the first real token of the deeper line, not the line
        // start — a block's $self span begins at its content.
        synth('INDENT', pos);
        if (body) bodyKinds.set(last().id, body);
        // A schema header's first deeper line opens its body block.
        const sf = dslTop();
        if (sf?.kind === 'schema' && sf.bodyDepth === null && !sf.inline) sf.bodyDepth = indents.length;
      } else {
        if (prefix !== current) dedentTo(prefix, lineStart);
        // Same level (or just dedented): the newline separates statements —
        // except before continuation keywords, which extend the enclosing
        // statement (`else` → if, `catch`/`finally` → try), and never
        // doubled (a `;` may already have ended the statement).
        // In render, a tight hyphen makes the word a custom element
        // (`else-x`), never the continuation keyword.
        // A schema body line is never a continuation, so a field may be
        // named `else`; inside an island (a member's body) the keyword
        // continues the island's code, as it does everywhere else.
        const continues = !inDsl() && ['else', 'catch', 'finally'].some(
          (w) => text.startsWith(w, pos) && !IDENT_PART.test(text[pos + w.length] ?? '') &&
            !(inMode('render') && text[pos + w.length] === '-' && IDENT_START.test(text[pos + w.length + 1] ?? '')),
        );
        // A keyword continuing an island at its own depth: its token is
        // the next one minted.
        const top = dslTop();
        if (continues && top?.kind === 'island' && top.exit !== 'params' && indents.length <= top.depth) {
          islandLineKeywords.add(nextId);
        }
        if (tokens.length > 0 && lastNewlinePos >= 0 && !continues && last()?.kind !== 'TERMINATOR') {
          const nl = text[lastNewlinePos] === '\r' ? 2 : 1;
          pushTerminator(text.slice(lastNewlinePos, lastNewlinePos + nl), lastNewlinePos, lastNewlinePos + nl, { generated: true });
        }
      }
      // A line back at (or above) the render statement's own depth
      // leaves the render block.
      if (inMode('render') && indents.length <= modeFrame('render').depth) {
        closeModeKind('render');
        closeModeKind('render-code');
      }
      atLineStart = false;
      pendingNewLine = true;
      if (inMode('for') && parens.length <= modeFrame('for').parens) closeModeKind('for');
      if (parens.length === 0) {
        closeModeKind('import');
        closeModeKind('export');
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
      const prev = last();
      // A class's digit run (`div.p-4#x`, `div.p-4-2#x`) ends in a NUMBER
      // the gate joins into the class; the id glues onto it like onto a
      // name, and chainStartFrom walks the whole hyphenated tail back to
      // the chain's root.
      const isHyphen = (t) => t?.kind === '-' || (t?.kind === 'MATH' && t.value === '-');
      let root = tokens.length - 1;
      while ((tokens[root]?.kind === 'NUMBER' || (root < tokens.length - 1 && tokens[root]?.kind === 'PROPERTY')) &&
             isHyphen(tokens[root - 1]) && (tokens[root - 2]?.kind === 'NUMBER' || tokens[root - 2]?.kind === 'PROPERTY')) root -= 2;
      const digitClass = prev?.kind === 'NUMBER' && /^[0-9]+$/.test(prev.value) &&
        root < tokens.length - 1 && tokens[root]?.kind === 'PROPERTY' && tokens[root - 1]?.kind === '.';
      const glued = inMode('render') && prev && (prev.kind === 'IDENTIFIER' || prev.kind === 'PROPERTY' || digitClass) &&
        !pendingSpaced && !prev.generated && text[pos + 1] !== undefined && !/\s/.test(text[pos + 1]);
      if (glued && selectorScope()) {
        // An element's id: one, glued to the tag or `.class` chain that
        // heads its line, a name from the identifier vocabulary (hyphens
        // inside it). Glued to anything else, `#` is neither an id nor a
        // comment.
        if (!headSelectorAt(chainStartFrom(tokens.length - 1))) {
          const written = /^[^\s"'`,()]*/.exec(text.slice(pos + 1))[0];
          fail(`\`#${written}\` is no element id here: an id follows the HTML tag or \`.class\` that starts its line (otherwise write \`id: '${written}'\`), and a comment needs a space before \`#\``, pos);
        }
        if (!IDENT_START.test(text[pos + 1])) failSelector('id', pos + 1);
        let end = pos + 2;
        while (end < text.length && (IDENT_PART.test(text[end]) || (text[end] === '-' && IDENT_PART.test(text[end + 1] ?? '')))) end++;
        if ('-/[{'.includes(text[end] ?? ' ') || (text[end] === ':' && /[^\s=:]/.test(text[end + 1] ?? ' '))) {
          failSelector('id', pos + 1);
        }
        for (let k = tokens.length - 1; k >= 0 && ['PROPERTY', '.', 'IDENTIFIER', 'NUMBER', '-', 'MATH'].includes(tokens[k].kind); k--) {
          if (String(tokens[k].value).includes('#')) fail('an element has one id', pos);
          if (tokens[k].kind === 'IDENTIFIER') break;
        }
        prev.value += text.slice(pos, end);
        prev.end = end;
        pos = end;
        continue;
      }
      if (inMode('render') && IDENT_START.test(text[pos + 1] ?? '') && prev &&
          (prev.kind === 'TERMINATOR' || prev.kind === 'INDENT' || prev.kind === 'OUTDENT' || prev.kind === 'RENDER')) {
        let end = pos + 2;
        while (end < text.length && (IDENT_PART.test(text[end]) || (text[end] === '-' && IDENT_PART.test(text[end + 1] ?? '')))) end++;
        if ('-/[{'.includes(text[end] ?? ' ') || (text[end] === ':' && /[^\s=:]/.test(text[end + 1] ?? ' '))) {
          failSelector('id', pos + 1);
        }
        push('IDENTIFIER', `div${text.slice(pos, end)}`, pos, end);
        pos = end;
        continue;
      }
      let end = pos;
      while (end < text.length && text[end] !== '\n' && !(text[end] === '\r' && text[end + 1] === '\n')) end++;
      trivia.push({ kind: 'comment', start: pos, end, text: text.slice(pos, end) });
      pos = end;
      continue;
    }

    // Inside a schema body (not in one of its islands), the schema
    // alphabet.
    if (openModes.schema > 0 && inDsl() && scanSchemaToken(ch)) continue;

    // `$` bridging a value to a string spells a tagged template with
    // the space before the tag intact: `sh $"cmd"` → sh`cmd`. The `$`
    // is the TEMPLATE_TAG token (its span, one character). A `$`
    // anywhere else stays an identifier — claimed here because the
    // identifier scanner would otherwise take the `$` as a name.
    if (ch === '$' && (text[pos + 1] === '"' || text[pos + 1] === "'")) {
      const prevTok = tokens[tokens.length - 1];
      if (prevTok && TAGGABLE.has(prevTok.kind)) {
        push('TEMPLATE_TAG', '$', pos, pos + 1);
        pos += 1;
        continue;
      }
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
      // classification: `when: 1` and `if: 2` are pairs). A colon a
      // pending ternary claims never keys; `::` and `:=` never key — the
      // prototype operator and the reactive assign own those colons.
      // A SPACED colon tight to a following word is a SYMBOL, never a
      // key (`a is :b`, `schema :model` — the schema-kind rule
      // generalized); a tight colon (`when: 1`) or a spaced colon with
      // a spaced value (`{a : b}`) keys as before.
      const afterWord = text.slice(pos);
      const tightColon = /^:(?![=:])/.test(afterWord);
      const spacedColon = /^[^\S\n]+:(?![=:])/.exec(afterWord);
      const symbolish = spacedColon !== null && IDENT_START.test(afterWord[spacedColon[0].length] ?? '');
      const keysColon = (tightColon || (spacedColon !== null && !symbolish)) && !ternary.pending;
      if (word === 'schema' && !keysColon) {
        const pragma = (prev === null || prev.kind === 'TERMINATOR' || prev.kind === 'INDENT' || prev.kind === 'OUTDENT') &&
          schemaPragmaAt(text, pos);
        if (pragma) {
          scanSchemaPragma(pragma);
          continue;
        }
        if (schemaOpens(prev, pendingSpaced)) {
          openSchema(start, pos);
          continue;
        }
      }
      if (prev && (prev.kind === '.' || prev.kind === '?.' || (prev.kind === '@' && !pendingSpaced))) {
        // Render blocks: a `.class-name` chain consumes tight hyphens
        // (`.counter-display` is ONE class name); never when
        // the run keys a pair, and ONLY on class-SELECTOR chains — a
        // chain rooted at a template tag (`div.counter-display`) or a
        // bare line-start dot (`.counter-display`). Member chains in
        // value positions keep the subtraction reading (`@box.w-pad`
        // is `this.box.value.w - pad`).
        let value = word;
        if (inMode('render') && prev.kind === '.' && !keysColon && classSelectorChain()) {
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
      } else if (customElementEnd(prev, pos) !== null) {
        // A tight-hyphen word at a render child position names a custom
        // element (`x-icon`, `do-it`, `sl-button.primary`) — the platform
        // requires the hyphen, so the run is ONE tag name, never a
        // subtraction, whatever its first word spells.
        pos = customElementEnd(prev, pos);
        push('IDENTIFIER', text.slice(start, pos), start, pos);
      } else if (word !== 'default' && word !== 'as' && foreignModuleName(prev, afterWord)) {
        // A specifier's FOREIGN side names something in another module,
        // never a binding here — the imported name before `as`, the
        // exported name after it — so it is a name whatever it spells,
        // the way a word after a dot is (`{ render as draw }`,
        // `{ draw as render }`). JavaScript reads both sides the same.
        push('IDENTIFIER', word, start, pos);
      } else if (inMode('import') && word !== 'default' && word !== 'type' && reservedSpelling(word) &&
                 (specifierStart(prev) || prev?.kind === 'AS' || prev?.kind === 'IMPORT')) {
        // The LOCAL side is a binding, and a keyword cannot be one.
        fail(`'${word}' is a Rip keyword, so it cannot be the local name of an import — bind it under another name (\`import { ${word} as ${word}_ } from '…'\`)`, start, pos);
      } else if (word === 'import') {
        // `import(` / `import!(` is the dynamic-import CALL and
        // `import.` heads the import.meta member — neither opens a
        // module statement; everything else is the IMPORT keyword.
        if (text[pos] === '(' || (text[pos] === '!' && text[pos + 1] === '(')) {
          push('DYNAMIC_IMPORT', word, start, pos);
        } else if (text[pos] === '.') {
          push('IMPORT_META', word, start, pos);
        } else {
          if (!inMode('import')) openMode('import');
          push('IMPORT', word, start, pos);
        }
      } else if (word === 'export') {
        if (!inMode('export')) openMode('export');
        push('EXPORT', word, start, pos);
      } else if (word === 'type' && prev?.kind === 'IMPORT' && (() => {
        // Contextual: `import type` opens a TYPE-ONLY import — the
        // author's declaration that the module is needed for types
        // alone, so the whole statement (side effects included) erases
        // from the JS. TypeScript's lookahead rule disambiguates, and
        // both plain readings must survive: `type` followed by `{`,
        // `*`, or an identifier that is not `from` is the keyword;
        // `import type from 'mod'` (a default binding named `type`)
        // and `import { type } from 'mod'` (prev is `{`, not IMPORT)
        // stay identifiers.
        let at = pos;
        while (text[at] === ' ' || text[at] === '\t') at++;
        const next = text[at] ?? '';
        if (next === '{' || next === '*') return true;
        if (!IDENT_START.test(next)) return false;
        let j = at + 1;
        while (j < text.length && IDENT_PART.test(text[j])) j++;
        return text.slice(at, j) !== 'from';
      })()) {
        push('IMPORT_TYPE', word, start, pos);
      } else if (word === 'type' && prev?.kind === 'EXPORT' && (() => {
        // Contextual: `export type {` opens a TYPE-ONLY re-export, the
        // mirror of `import type`. Only the brace selects it: `export
        // type Name = …` is a declaration (src/types.js folds it), and
        // `export type = 1` is a binding named `type`.
        let at = pos;
        while (text[at] === ' ' || text[at] === '\t') at++;
        return text[at] === '{';
      })()) {
        push('EXPORT_TYPE', word, start, pos);
      } else if (word === 'type' && parens[parens.length - 1]?.specifiers === true && (() => {
        // TypeScript's per-name `{ type A, B }` has no rip spelling:
        // type-only is the statement's. `type` followed by a name is
        // that spelling, where `{ type }`, `{ type, A }`, and
        // `{ type as T }` bind a name called `type`. Left alone it
        // parses as a call, `type(A)`, and the rejection names a
        // parenthesis the author never wrote.
        let at = pos;
        while (text[at] === ' ' || text[at] === '\t') at++;
        if (!IDENT_START.test(text[at] ?? '')) return false;
        let j = at + 1;
        while (j < text.length && IDENT_PART.test(text[j])) j++;
        return text.slice(at, j) !== 'as';
      })()) {
        const verb = inMode('import') ? 'import' : 'export';
        fail(`a specifier takes no \`type\` keyword — type-only is the whole statement's: write \`${verb} type { … } from '…'\` for the type names, beside a plain ${verb} for the rest` +
          (inMode('import') ? '' : '; a local type exports at its own declaration'), start, pos);
      } else if (word === 'as' && inMode('for')) {
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
        closeModeKind('for');
      } else if (word === 'as' && (inMode('import') || inMode('export')) &&
                 (prev?.kind === 'DEFAULT' || prev?.kind === 'IMPORT_ALL' || prev?.kind === 'EXPORT_ALL' ||
                  (prev?.kind === 'IDENTIFIER' && parens[parens.length - 1]?.specifiers === true))) {
        // Contextual: only inside a module line, after a specifier
        // — `as = 2` elsewhere stays an identifier. A name renames
        // only inside the specifier braces; in an export's value the
        // name is an operand and its `as` is the cast.
        push('AS', word, start, pos);
      } else if (word === 'with' && inMode('import') && (prev?.kind === 'STRING' || prev?.kind === 'STRING_END')) {
        // Contextual: import attributes, after the module source
        // (`import d from './d.json' with { type: 'json' }`) —
        // reserved everywhere else.
        push('WITH', word, start, pos);
      } else if (word === 'default' && (inMode('import') || inMode('export')) &&
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
        // connectors (the `for` mode frame); elsewhere they are the
        // RELATION operators.
        if (inMode('for')) {
          push(word === 'in' ? 'FORIN' : 'FOROF', word, start, pos);
          closeModeKind('for');
        } else {
          push('RELATION', word, start, pos);
        }
      } else if (word === 'for') {
        closeModeKind('for');
        openMode('for');
        push('FOR', word, start, pos);
      } else if (STATEMENTS.has(word)) {
        push('STATEMENT', word, start, pos);
      } else if (ALIASES[word]) {
        const [kind, value] = ALIASES[word];
        // `x is not y` reads as `x === !y` — a comparison against a
        // negation, never what was meant. The negated comparison is
        // `isnt`; the rejection names it.
        if (word === 'is' && (text[pos] === ' ' || text[pos] === '\t')) {
          const not = NOT_WORD.exec(text.slice(pos));
          if (not !== null) {
            fail("'is not' compares against a negation — `x is not y` reads as `x === !y`; spell the negated comparison `x isnt y`", start, pos + not[0].length);
          }
        }
        // Word compound assignments: `and=` / `or=` are COMPOUND_ASSIGN
        // with the operator value, span covering word + '='.
        if ((word === 'and' || word === 'or') && text[pos] === '=' && text[pos + 1] !== '=') {
          pos++;
          push('COMPOUND_ASSIGN', `${value}=`, start, pos);
        } else {
          // Type text owns the `is` predicate spelling; the source word
          // rides with rewritten tokens so collectTypeRun can preserve
          // it only in the admitted predicate position.
          push(kind, value, start, pos, { word });
        }
      } else if ((word === 'offer' || word === 'accept') && insideComponentBody()) {
        push(word === 'offer' ? 'OFFER' : 'ACCEPT', word, start, pos);
      } else if (word === 'own' && last()?.kind !== 'FOR') {
        // `own` is a keyword only where the grammar reads it, directly
        // after FOR; everywhere else it is an ordinary name.
        push('IDENTIFIER', word, start, pos);
      } else if (KEYWORDS[word]) {
        push(KEYWORDS[word], word, start, pos);
        if (KEYWORDS[word] === 'RENDER') {
          const frame = modeFrame('render') ?? openMode('render');
          frame.depth = indents.length;
          frame.parens = parens.length;
        }
      } else if (word === 'private' && insideClassBody() &&
                 (prev?.kind === 'INDENT' || prev?.kind === 'TERMINATOR' || prev?.kind === 'OUTDENT')) {
        // The class-member modifier: a keyword only at the head of a
        // member line in a class body (the grammar's member rows are
        // the only shapes that take it), reserved everywhere else. An
        // accessor takes no modifier — `get x: ->` parses as a call of
        // `get`, which no member row heads — so the shape rejects here
        // by name rather than at the parser's dedent.
        if (ACCESSOR_HEAD.test(afterWord)) {
          fail('`private` is not supported on a get/set accessor — it marks methods and fields', start);
        }
        push('PRIVATE', word, start, pos);
      } else if (word === 'new' && text[pos] === '.' && /^\.target\b/.test(text.slice(pos))) {
        // `new.target` heads a meta-property member (the import.meta
        // precedent); any other `new` is RESERVED.
        push('NEW_TARGET', 'new', start, pos);
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
      // `div.2xl` / `.2xl` at the head of a line: a class starting with a
      // digit, which the shorthand cannot hold.
      if (ch === '.' && inMode('render') && selectorScope() && !pendingSpaced) {
        const before = last();
        const headTag = before?.kind === 'IDENTIFIER' && !before.generated && headSelectorAt(tokens.length - 1);
        if (headTag || !before || SELECTOR_LINE_STARTS.has(before.kind)) failSelector('class', pos + 1);
      }
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
      // A string RIGHT AGAINST a value token (no gap) is a tagged
      // template: `tag"x"`, `obj.fn"x"`, `f(1)"x"`. The zero-width
      // TEMPLATE_TAG marks the boundary; a SPACED string keeps its
      // implicit-call reading (`tag "x"` → tag("x")). The tight
      // spelling was a parse error before this claim.
      const prevTok = tokens[tokens.length - 1];
      if (prevTok && TAGGABLE.has(prevTok.kind) && prevTok.end === pos) {
        // In a template, an element's tag or selector heading its line is
        // never a tag function: text glued to it (`div#a"x"`) is a typo.
        if (inMode('render') && (prevTok.kind === 'IDENTIFIER' || prevTok.kind === 'PROPERTY') && !prevTok.generated &&
            selectorScope() && headSelectorAt(chainStartFrom(tokens.length - 1))) {
          fail("a space goes between an element's selector and its text", pos);
        }
        push('TEMPLATE_TAG', '$', pos, pos);
      }
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

    // ── Word arrays: %w[foo bar baz] → ['foo', 'bar', 'baz'] ──
    // Delimiters pair ([ ] ( ) { } < >, nesting counted) or repeat
    // symmetrically (%w|a b|, %w/x y/); backslash-space keeps a space
    // inside a word. The scan emits REAL bracket/string/comma tokens
    // with each word's true span, so mapping stays exact. The tight
    // spelling is claimed: `a % w[i]` keeps modulo with a space.
    if (text[pos] === '%' && text[pos + 1] === 'w') {
      const opener = text[pos + 2];
      if (opener && !/[\s\w]/.test(opener)) {
        const WORD_PAIRS = { '[': ']', '(': ')', '{': '}', '<': '>' };
        const closer = WORD_PAIRS[opener] ?? opener;
        const paired = closer !== opener;
        let depth = 1;
        let i = pos + 3;
        while (i < text.length && depth > 0) {
          const ch = text[i];
          if (ch === '\\') { i += 2; continue; }
          if (paired && ch === opener) depth++;
          if (ch === closer) depth--;
          if (depth > 0) i++;
        }
        if (depth !== 0) failOpenAtEnd(`unclosed %w${opener} — never closed by '${closer}'`, pos, pos + 3);
        push('[', '[', pos, pos + 3);
        const wordRe = /(?:\\\s|\S)+/g;
        wordRe.lastIndex = pos + 3;
        let m2;
        let first = true;
        let prevEnd = pos + 3;
        while ((m2 = wordRe.exec(text)) !== null && m2.index < i) {
          const wEnd = Math.min(m2.index + m2[0].length, i);
          const word = text.slice(m2.index, wEnd).replace(/\\ /g, ' ');
          if (!first) push(',', ',', prevEnd, m2.index);
          push('STRING', JSON.stringify(word), m2.index, wEnd);
          first = false;
          prevEnd = wEnd;
          if (wEnd >= i) break;
          wordRe.lastIndex = wEnd;
        }
        push(']', ']', i, i + 1);
        pos = i + 1;
        continue;
      }
    }

    // ── Operators and punctuation (longest match first) ──
    // `s !~ /re/` (Ruby's no-match) would read as the call `s(!~/re/)`:
    // an operand, a space, `!~`, a space. Rip has no `!~`; the prefix
    // `!~x` (the indexOf idiom) stays legal.
    if (text.startsWith('!~', pos) && pendingSpaced && INDEXABLE.has(last()?.kind) && /\s/.test(text[pos + 2] ?? '')) {
      fail("Rip has no '!~' operator — write `not (s =~ /re/)`", pos, pos + 2);
    }
    const four = text.slice(pos, pos + 4);
    if (OPS4[four]) {
      push(OPS4[four], four, pos, pos + 4);
      pos += 4;
      continue;
    }
    const three = text.slice(pos, pos + 3);
    // The literal strict spellings normalize to the two-character
    // COMPARE values (which EMIT strict): all four spellings mean
    // strict equality — there is no loose-equality surface. A tight
    // `===` had no other reading, so the claim is safe.
    if (three === '===' || three === '!==') {
      push('COMPARE', three.slice(0, 2), pos, pos + 3);
      pos += 3;
      continue;
    }
    if (OPS3[three]) {
      push(OPS3[three], three, pos, pos + 3);
      pos += 3;
      continue;
    }
    const two = text.slice(pos, pos + 2);
    // `?=` assigns when the target is nullish — the `??=` compound's
    // short spelling. The token VALUE is '??=' (one operator
    // downstream); the span covers the two source characters. A tight
    // `?=` had no other reading (postfix `?` + `=` was a parse error).
    if (two === '?=' && text[pos + 2] !== '=') {
      push('COMPOUND_ASSIGN', '??=', pos, pos + 2);
      pos += 2;
      continue;
    }
    // `*{` claims only the STAR (span one char) — the `{` scans next
    // as a normal brace, so brace matching and the implicit passes
    // never see a special opener.
    if (two === '*{') {
      push('MAP_START', '*', pos, pos + 1);
      pos += 1;
      continue;
    }
    // A tight `.=` names no property, so no legal program spells it;
    // the assignment it reads as spells its target twice.
    if (two === '.=') fail('`.=` is not an operator; write the assignment out: `x = x.trim()`', pos, pos + 2);
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
      if (ch === '*' && inMode('import') && (last()?.kind === 'IMPORT' || last()?.kind === 'IMPORT_TYPE' || last()?.kind === ',')) push('IMPORT_ALL', ch, pos, pos + 1);
      else if (ch === '*' && last()?.kind === 'EXPORT') push('EXPORT_ALL', ch, pos, pos + 1);
      // `yield*` on the yield's own line is delegation, the same FROM
      // token `yield from` produces: JavaScript reads the spelling that
      // way, and a bare yield multiplied by the next operand is never
      // what the author meant. A `*` opening the next line stays MATH.
      else if (ch === '*' && last()?.kind === 'YIELD' && !pendingNewLine) push('FROM', ch, pos, pos + 1);
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
      // directly after a value-ending token is maybe dammit, the
      // awaited optional call (`f?!` → `await f?.()`, `f?!(x)` /
      // `f?! x` → `await f?.(x)`) — dammit's `f!` with an optional callee,
      // and a '?' directly after a value-ending token is the postfix
      // existence check (`a?` → `a != null`) — real tokens and nodes.
      // A juxta argument after that existence token (`f? x`) is an
      // optional call: `?` is IMPLICIT_FUNC, so implicitCalls wraps the
      // args and the grammar builds `Value ? Arguments` as the optional
      // call (same as `f?(x)`). Bare `a?` with no juxta arg stays existence.
      if (!pendingSpaced) {
        if (text[pos + 1] === '(' || text[pos + 1] === '[') {
          push('?.', '?', pos, pos + 1);
          pos++;
          continue;
        }
        const prev = last();
        if (text[pos + 1] === '!' && prev && !prev.generated && INDEXABLE.has(prev.kind)) {
          // Maybe dammit calls what dammit calls: a name (`f?!`,
          // `obj.method?!`). After any other value it has no reading.
          if (prev.kind !== 'IDENTIFIER' && prev.kind !== 'PROPERTY') {
            fail("maybe dammit '?!' follows a name, as dammit does (`f?!`, `obj.method?!`) — bind the value to a name first", pos, pos + 2);
          }
          push('MAYBE_DAMMIT', '?!', pos, pos + 2);
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
          const nameSlot = beforeName === null || beforeName.kind === '@' || beforeName.kind === 'PRIVATE' ||
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
        // A mapped type's optionality MODIFIER: `]-?:` / `]+?:` — the
        // spelling behind TS's own Required<T>. The `?` rides the
        // `-`/`+` directly after the mapped row's `]`, with the member
        // `:` right behind it; nothing value-shaped ever scans this
        // sequence (it failed the ternary rejection below before this
        // carve-out existed), so the plain token is safe to emit and
        // the type vocabulary judges the rest.
        const beforePrev = tokens[tokens.length - 2] ?? null;
        if (prev && (prev.kind === '-' || prev.kind === '+') && !prev.spaced &&
            (beforePrev?.kind === ']' || beforePrev?.kind === 'INDEX_END') &&
            text[pos + 1] === ':') {
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
      const params = dslTop();
      if (params?.kind === 'island' && params.exit === 'params' && parens.length < params.parens) {
        closeParams(params, pos + 1);
        pos++;
        continue;
      }
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
        // A module statement's specifier list: the brace an import or
        // export keyword opens, or the one after a default binding's comma.
        const specifiers = dot != null && (dot.kind === 'IMPORT' || dot.kind === 'IMPORT_TYPE' ||
          dot.kind === 'EXPORT' || dot.kind === 'EXPORT_TYPE' || (inMode('import') && dot.kind === ','));
        openBracket('object', pos, specifiers ? { specifiers: true } : {});
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
    // Symbol literals: `:name`, `:domain.name`, `:kebab-name`, and a
    // single trailing `!`/`?` (`:save!`, `:valid?`, claimed only at a
    // clear boundary — symbolNameEnd) become one interned name — only
    // where the
    // colon CANNOT be structural: after a value-ending token the
    // colon is a key/annotation/ternary colon (`{a:b}`, `x:number`,
    // `c ? a :b` all keep their readings). A SPACED colon after a
    // callable head is the argument of an implicit call, never a key —
    // `x.y :z`, `@y :z` and `x[0] :z` call as `f :z` does — unless a
    // pending ternary claims it (`c ? x.y :z`), or the head closes a
    // parameter list whose return type follows: a plain `)` may close
    // an arrow's (`(a) :T ->`, told apart from a call only at the
    // arrow), and a CALL_END may close a def's (`def f(a) :T`). A
    // schema's kind and its body's symbols are schema mode's own. Type
    // bodies use colons structurally and never mint.
    if (ch === ':' && IDENT_START.test(text[pos + 1] ?? '') &&
        !insideTypeBody() && !aliasHeadOpen()) {
      const prevTok = tokens[tokens.length - 1];
      const callsArgument = pendingSpaced && prevTok !== undefined &&
        IMPLICIT_FUNC.has(prevTok.kind) && prevTok.kind !== ')' && !ternary.pending &&
        !(prevTok.kind === 'CALL_END' && closesDefParams(tokens, tokens.length - 1));
      const structural = prevTok !== undefined && !callsArgument && (
        prevTok.kind === 'PROPERTY' ||
        prevTok.kind === ')' || prevTok.kind === ']' || prevTok.kind === '}' ||
        prevTok.kind === 'CALL_END' || prevTok.kind === 'INDEX_END' ||
        prevTok.kind === 'PARAM_END' || prevTok.kind === 'PICK_END' ||
        prevTok.kind === 'STRING' || prevTok.kind === 'STRING_END' ||
        prevTok.kind === 'NUMBER' || prevTok.kind === 'REGEX' ||
        prevTok.kind === 'HEREGEX_END' || prevTok.kind === 'BOOL' ||
        prevTok.kind === 'NULL' || prevTok.kind === 'UNDEFINED' ||
        prevTok.kind === 'DAMMIT' || prevTok.kind === '?' ||
        prevTok.kind === 'MAYBE_DAMMIT' || prevTok.kind === 'OPT_MARKER' ||
        prevTok.kind === 'THIS' || prevTok.kind === '@' || prevTok.kind === 'SYMBOL' ||
        // A pending ternary's ELSE colon: after a bare identifier the
        // colon closes the ternary (`c ? d :e`); after `?` or another
        // colon the branch NEEDS a value, so `:yes` mints
        // (`c ? :yes : :no`).
        (ternary.pending && prevTok.kind === 'IDENTIFIER'));
      if (!structural) {
        const end2 = symbolNameEnd(text, pos + 1);
        push('SYMBOL', text.slice(pos + 1, end2), pos, end2);
        pos = end2;
        continue;
      }
    }
    if (ch === ';') {
      pushTerminator(ch, pos, pos + 1);
      pos++;
      continue;
    }
    if (ch === ',' && openModes.island > 0) commaEndsIsland();
    if (ch === '=' || ch === '+' || ch === '-' || ch === '.' || ch === ',' || ch === ':') {
      push(ch, ch, pos, pos + 1);
      pos++;
      continue;
    }

    // A backtick in a TYPE position opens a template-literal type —
    // TS type text Rip carries through verbatim. Type positions are
    // the scanner-known ones: inside a type-body block, or on a
    // `type Name =` alias head's own line. In VALUE position a
    // backtick is not Rip syntax at all — strings are quote-based —
    // and falls through to the raw rejection below.
    if (ch === '`' && (insideTypeBody() || aliasHeadOpen())) {
      const end = scanTypeTemplateEnd(pos);
      push('TYPE_TEMPLATE', text.slice(pos, end), pos, end);
      pos = end;
      continue;
    }

    fail(`cannot tokenize '${ch}'`, pos);
  }

  // Unclosed brackets reject at the OUTERMOST unclosed opener — the
  // FIRST opener in source order that never finds its closer (every
  // frame still open at EOF nests inside it) — with the opener's own
  // glyph and span, so the caret lands on the bracket to fix, not at
  // end of input.
  if (parens.length > 0) {
    // In tolerant mode, an open bracket at end of input synthesizes the
    // closer its frame implies — innermost first, each recorded as a
    // diagnostic — instead of rejecting the whole scan. The OUTDENT loop
    // below is this exact move for blocks; brackets extend it. Interp
    // frames keep the throw (the scan is suspended inside a string
    // literal there; resuming it is the string scanner's business).
    const tolerable = tolerant && parens.every((f) => f.kind !== 'interp');
    if (!tolerable) {
      const open = parens[0];
      const glyph = { call: '(', group: '(', index: '[', array: '[', object: '{', interp: '#{' }[open.kind] ?? open.kind;
      failOpenAtEnd(`unclosed '${glyph}' — never closed by end of input`, open.at, open.at + glyph.length);
    }
    // Everything synthesized here anchors where the CURSOR pauses — past
    // trailing intraline whitespace, before trailing newlines — so a
    // hole's zero-width row IS the position a completion or signature
    // request carries, and every closer sits at or after the content it
    // closes (a closer anchored earlier would put the hole outside its
    // own frame's role span, where no claim can reach it).
    let cursorEnd = text.length;
    while (cursorEnd > 0 && (text[cursorEnd - 1] === '\n' || text[cursorEnd - 1] === '\r')) cursorEnd--;
    while (parens.length > 0) {
      const frame = parens[parens.length - 1];
      const glyph = { call: '(', group: '(', index: '[', array: '[', object: '{' }[frame.kind] ?? frame.kind;
      lexDiagnostics.push({
        message: `unclosed '${glyph}' — never closed by end of input`,
        start: frame.at, end: frame.at + glyph.length, expected: [], got: 'end of input',
      });
      const closerKind =
        frame.kind === 'call' ? 'CALL_END' :
        frame.kind === 'group' ? ')' :
        frame.kind === 'index' ? 'INDEX_END' :
        frame.kind === 'array' ? ']' :
        frame.pick ? 'PICK_END' : '}';
      closeBracket();
      // A synthetic closer directly after a comma would let the grammar's
      // trailing-comma tolerance swallow the in-progress argument slot —
      // and the emitted face would drop the comma, losing the position
      // signature help's activeParameter is computed from. A zero-width
      // IDENTIFIER hole keeps the slot.
      //
      // The SAME slot has to be kept when the bracket is still EMPTY —
      // `add(` and `items[`, the first keystroke of every call and every
      // index. A closer straight after the opener emits `add()`, a
      // complete zero-argument call with no position between the
      // parens, so the cursor resolves to nothing and signature help
      // answers null. Only `call` and `index` qualify: an empty
      // IDENTIFIER is a legal argument and a legal subscript, where in
      // an object literal it would fabricate a property name and in an
      // array an element the user has not typed.
      // The probe reaches PAST the structure tokens closeBracket just
      // minted: a multiline call's trailing comma sits behind the
      // OUTDENT that closed its argument block, and the slot must be
      // kept INSIDE that block — the hole splices before the structure,
      // where a real argument would sit — or the face completes the
      // call without the position activeParameter is computed from.
      // Single-line streams have no trailing structure, so the splice
      // degenerates to the plain append.
      let at = tokens.length;
      while (at > 0 && (tokens[at - 1].kind === 'OUTDENT' || tokens[at - 1].kind === 'INDENT' ||
                        tokens[at - 1].kind === 'TERMINATOR')) at--;
      const tail = tokens[at - 1]?.kind;
      const emptySlot =
        (frame.kind === 'call' && tail === 'CALL_START') ||
        (frame.kind === 'index' && tail === 'INDEX_START');
      if (tail === ',' || emptySlot) {
        const hole = {
          id: nextId++,
          kind: 'IDENTIFIER', value: '', start: cursorEnd, end: cursorEnd,
          spaced: false, newLine: false, generated: true, origin: null,
        };
        pendingOrigin.push(hole);
        tokens.splice(at, 0, hole);
      }
      synth(closerKind, cursorEnd);
    }
  }

  // Close any open blocks at end of input, anchored at the end of the
  // last real content (trailing newlines/trivia never extend spans).
  const eofEnd = lastRealEnd();
  while (indents.length > 1) popIndent(eofEnd);
  // What is still open ends with the input: an inline body, an island
  // at the top level, or a header that never opened a body.
  for (let t = dslTop(); t !== null; t = dslTop()) {
    if (t.kind === 'schema') closeSchema(t);
    else if (t.exit === 'params') failOpenAtEnd("unclosed '(' — never closed by end of input", t.at, t.at + 1);
    else closeIsland(t);
  }

  // Post-scan passes: scan → retagTape → rewriteTypes → implicitBlocks →
  // tagPostfixConditionals → implicitObjects → implicitCalls →
  // finishLayout → tape. Order matters: parameter retagging reads
  // pre-insertion arrow context; implicit INDENTs must exist before
  // postfix detection (a then-body if is a PREFIX if); postfix retagging
  // must precede implicit calls so `f if x` guards f instead of calling
  // it; loose-else tagging needs the implicit calls and objects in place,
  // since a comma inside `g a, b` belongs to the call and closes nothing
  // outside it.
  const mintId = () => nextId++;
  // Definition-site bangs resolve here, BEFORE rewriteTypes (its
  // def-context scans read VOID_MARKER); the object/class-key form
  // resolves later, inside implicitObjects, where ternary context is
  // known.
  retagTape(tokens);
  // The passes after the retags, over the tape and, below, over each
  // schema island. Types collapse BEFORE the implicit-structure passes: a
  // claimed annotation colon can no longer open an implicit object, and a
  // claimed `as` can no longer head an implicit call. A schema body never
  // reaches them: the scanner cut it from the tape.
  // `opened` collects every implicit call's and object's opener, on the
  // tape and in the islands: the openers the parser driver may close
  // early. A parameter, never a captured variable, so no closure the
  // results keep holds it after the parse.
  const layout = (toks, opened) => {
    // `do` invokes a function literal, and retagTape retagged every one
    // it heads to DO_IIFE. A DO before a parenthesis heads the function
    // the parentheses hold (the emitter rejects anything else inside);
    // a DO left after that heads anything else, or nothing — and a line
    // break cannot supply its function, so a trailing `do` is an error,
    // never an unfinished line.
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].kind !== 'DO') continue;
      if (toks[i + 1]?.kind === '(') {
        toks[i].kind = 'DO_IIFE';
        continue;
      }
      fail('`do` invokes a function literal (`do ->`, `do (x) ->`, `do (-> …)`); call any other value directly: `f()`', toks[i].start, toks[i].end);
    }
    rewriteTypes(toks, mintId, text, fail, payloads, bodyKinds);
    // Reserved words are legal inside type runs (absorbed above); one
    // surviving in VALUE position is the original loud rejection.
    rejectReservedWords(toks, text, fail);
    // Render blocks rewrite BEFORE the implicit-structure passes: every
    // INDENT the pass sees is a real scanner block (never a synthesized
    // single-liner wrapper), and the tokens it injects (CALL_START,
    // arrows, pairs) participate in implicitObjects/implicitCalls like
    // user-written ones.
    rewriteRender(toks, mintId, fail);
    // Compound keys collapse AFTER render rewriting (a render block's
    // hyphenated class chains are render grammar, never object keys)
    // and BEFORE the implicit-structure passes (the collapsed STRING
    // must be the key implicitObjects reads).
    tagCompoundKeys(toks);
    implicitBlocks(toks, mintId);
    tagPostfixConditionals(toks);
    implicitObjects(toks, mintId, opened);
    implicitCalls(toks, mintId, opened);
    finishLayout(toks, fail);
  };
  const implicitOpeners = new Set();
  layout(tokens, implicitOpeners);
  // Each schema island's payload: its tokens run through the retags and
  // every pass above, so the parser reads embedded code as the program
  // reads its own. Islands run after the tape, so the tape's minted ids
  // are the tape's alone. The retags rewrite the island's own tokens, as
  // they rewrite the tape; the passes after them run over copies, since
  // the descriptor keeps each island's tokens (a hover reaches its words
  // there). One INDENT…OUTDENT pair wrapping a whole block body is the
  // member's, not a block of its code. An empty island (`m: ->`) is an
  // empty payload, which the program's start symbol reads as an empty
  // program.
  for (const { code, raw } of islands) {
    retagTape(raw);
    // A nested schema's SCHEMA_BODY stays itself: its payload is keyed by
    // the token.
    let toks = raw.map((t) => (t.kind === 'SCHEMA_BODY' ? t : { ...t }));
    if (toks[0]?.kind === 'INDENT' && closingOutdent(toks, 0) === toks.length - 1) toks = toks.slice(1, -1);
    layout(toks, implicitOpeners);
    // An `else` opening a line at the island's own depth continues its
    // code; one that closes no `if` there is the loose `or`, and the line
    // that reads as a field named `else` would vanish into the body.
    const loose = toks.find((t) => t.kind === 'LOOSE_ELSE' && t.newLine && islandLineKeywords.has(t.id));
    if (loose) {
      fail("an `else` line after a member's body continues that body as `a or b`, closing no `if` — a field named `else` goes above the member, and code continuing the body is indented", loose.start, loose.end);
    }
    payloads.set(code, toks);
  }

  return { tokens, trivia, source, lexDiagnostics, payloads, data, islandLineKeywords, implicitOpeners, nextId };
}

// The index of the OUTDENT that closes the INDENT at `at`, or -1.
const closingOutdent = (tokens, at) => {
  let depth = 0;
  for (let k = at; k < tokens.length; k++) {
    if (tokens[k].kind === 'INDENT') depth++;
    else if (tokens[k].kind === 'OUTDENT' && --depth === 0) return k;
  }
  return -1;
};

// Every RESERVED token left after rewriteTypes rejects from its own
// position.
export function rejectReservedWords(tokens, text, fail) {
  for (const [i, t] of tokens.entries()) {
    if (t.kind !== 'RESERVED') continue;
    if (t.value === 'private') {
      fail("'private' marks a class member — it heads a member line in a class body (`private helper: ->`) and is reserved everywhere else", t.start);
    }
    if (t.value === 'enum') {
      fail("'enum' is reserved — a set of values is a `type` union (`type Color = 'red' | 'green'`), and runtime values are a plain object", t.start);
    }
    if (t.value === 'new') {
      if (text[t.end] === '.') fail("'new.' heads only `new.target`", t.start, t.end);
      // Followed by what could name a constructor, it is the prefix
      // construction; anywhere else (`{new}`) it is a reserved word.
      const ctor = ['IDENTIFIER', '@', 'THIS', 'SUPER', '(', 'RESERVED'].includes(tokens[i + 1]?.kind);
      fail(ctor ? "construction is spelled `X.new(…)` — `new X` is not Rip"
        : "'new' is reserved — construction is spelled `X.new(…)`; a method named new is the member `new: ->`, called as `o['new']()`", t.start, t.end);
    }
    fail(`'${t.value}' is reserved and not supported yet`, t.start);
  }
}

// Postfix-conditional tagging:
// an IF/UNLESS that reaches its statement end (TERMINATOR, OUTDENT, or
// end of tape) before any INDENT is a postfix conditional — the guard of
// the expression before it — and retags to POST_IF/POST_UNLESS. A
// prefix conditional always opens its block (INDENT) first. Retag-only,
// per the retag-pass contract.
export function tagPostfixConditionals(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (counter.on) counter.n++;
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
      if (counter.on) counter.n++;
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
      if (NESTING[k] === 1) {
        depth++;
      } else if (NESTING[k] === -1) {
        depth--;
        if (depth < 0) break; // enclosing close — postfix
      }
    }
    if (postfix) tokens[i].kind = kind === 'IF' ? 'POST_IF' : 'POST_UNLESS';
  }
  return tokens;
}

// The layout walk after the implicit passes, which it needs in place:
// loose-operator tagging, `do (…)` tails and commaless arrow arguments,
// in one forward pass. Neither decision reads what another writes: the
// commas go in after the walk, and a `do` tail rejects after it, so a
// loose-operator rejection anywhere still reports first.
//
// Loose `and`/`or`. An ELSE after a closed block (OUTDENT) is an
// if/unless/switch tail, its body wrapped by implicitBlocks; one that
// closes a postfix IF/UNLESS earlier in its statement is that ternary's
// else; any other is the loose `or` operator and retags to LOOSE_ELSE,
// whose precedence is its own (the THEN level) rather than the if-tail's.
// Every THEN implicitBlocks left in place is the loose `and`. An
// expression takes one of the two: `a then b else c` is `(a && b) || c`,
// which reads as a conditional and is not one.
//
// `do (…)` invokes what its parentheses hold, so a tail after them —
// `do (-> f)(x)`, `.x`, `[0]`, `?`, a juxtaposed argument — could read
// as applying to the function before the invocation or to its result.
// Neither reading is the obvious one; both reject. The implicit passes
// have already turned a juxtaposed argument into a CALL_START.
const DO_TAILS = new Set(['CALL_START', 'INDEX_START', 'ES6_OPTIONAL_INDEX', '.', '?.', '?', 'TEMPLATE_TAG', 'PICK_START', 'OPTPICK_START', 'DAMMIT', 'MAYBE_DAMMIT']);
export function finishLayout(tokens, fail) {
  // Per nesting depth: unclaimed postfix conditionals, and whether the
  // statement already holds a loose operator.
  const open = [0], loose = [false];
  const commas = [];
  let calls = 0, doTail = null;
  for (let i = 0; i < tokens.length; i++) {
    if (counter.on) counter.n++;
    const t = tokens[i], k = t.kind, d = open.length - 1;
    // A render children arrow opens its block through layout as any arrow
    // does; the parser reads it as the element's children.
    if (t.children) t.kind = 'CHILDREN';
    if (k === 'CALL_START') calls++;
    else if (k === 'CALL_END') calls--;
    else if (calls > 0 && (k === '->' || k === '=>') && i > 0 &&
             (ARROW_COMMA_AFTER.has(tokens[i - 1].kind) ||
              (tokens[i - 1].kind === 'IDENTIFIER' &&
               (tokens[i - 1].value === 'Infinity' || tokens[i - 1].value === 'NaN')))) {
      commas.push(i);
    }
    if (k === 'DO_IIFE' && doTail === null && tokens[i + 1]?.kind === '(') {
      let depth = 0, j = i + 1;
      for (; j < tokens.length; j++) {
        if (counter.on) counter.n++;
        if (NESTING[tokens[j].kind] === 1) depth++;
        else if (NESTING[tokens[j].kind] === -1 && --depth === 0) break;
      }
      const tail = tokens[j + 1];
      if (tail && DO_TAILS.has(tail.kind)) doTail = tail;
    }
    const n = NESTING[k];
    if (n === 1) { open.push(0); loose.push(false); continue; }
    if (n === -1) { if (d > 0) { open.pop(); loose.pop(); } continue; }
    // A statement end or a comma closes the expression: each element,
    // argument, pair and parameter takes its own loose operator.
    if (k === 'TERMINATOR' || k === ',') { open[d] = 0; loose[d] = false; continue; }
    if (k === 'POST_IF' || k === 'POST_UNLESS') { open[d]++; continue; }
    if (k === 'ELSE' && tokens[i - 1]?.kind !== 'OUTDENT') {
      if (open[d] > 0) { open[d]--; continue; }
      t.kind = 'LOOSE_ELSE';
    }
    if (t.kind !== 'THEN' && t.kind !== 'LOOSE_ELSE') continue;
    if (loose[d]) {
      fail(`an expression takes one loose \`then\` or \`else\` — \`a then b else c\` is \`(a && b) || c\`, not a conditional; write \`if a then b else c\`, or chain with \`and\`/\`or\``, t.start, t.end);
    }
    loose[d] = true;
  }
  if (doTail !== null) {
    fail('`do (…)` takes no call, member or index tail — it could apply before the invocation or after it; parenthesize the one you mean: `(do (-> …)).x`', doTail.start, doTail.end);
  }
  if (commas.length === 0) return tokens;
  let read = tokens.length - 1, c = commas.length - 1;
  tokens.length += commas.length;
  for (let write = tokens.length - 1; c >= 0; write--) {
    if (counter.on) counter.n++;
    if (read < commas[c]) {
      const at = tokens[write + 1];
      tokens[write] = { kind: ',', value: ',', start: at.start, end: at.start };
      c--;
    } else {
      tokens[write] = tokens[read--];
    }
  }
  return tokens;
}

// Each implicit opener on `tape` and its closer, mapped both ways. Built
// before the driver's first splice into the tape, so the closers are the
// layout pass's own.
function pairImplicit(tape, implicit) {
  const pairs = new Map(), open = [];
  for (const t of tape) {
    const n = NESTING[t.kind];
    if (n === 1) open.push(t);
    else if (n === -1) {
      const opener = open.pop();
      if (implicit.has(opener)) pairs.set(opener, t).set(t, opener);
    }
  }
  return pairs;
}

// Adapter implementing the generated parser's lexer protocol:
//   setInput(input) then lex() → kind (falsy at EOF), exposing .text and
//   .loc = {start, end} after each lex(). A FRESH loc object is allocated
//   per token — the parser stores loc references on its location stack.
//   payload() is the current token's run when the token heads a grammar
//   entry: a TYPE, CAST or SATISFIES token (rewriteTypes' typeTape), a
//   SCHEMA_BODY token (the body in the schema alphabet) or a SCHEMA_CODE
//   token (an island of embedded code). The driver asks while it reads a
//   payload too, so the map answers for payload tokens as well. explain()
//   and finish() are the schema reader's two seams: the message for a
//   rejection inside a schema body, and the descriptors once the parse
//   accepts. dataSection() is the last input's __DATA__ section
//   ({ start, text } or null). The driver lexes through a derived object,
//   so the section lives in this closure, readable from the adapter the
//   caller holds.
//   implicitOpeners(), closeImplicit() and staleCloser() serve the
//   driver's parse-error(t) rule (below).
export function makeParserLexer(path = '<anonymous>', { tolerant = false } = {}) {
  let data = null;
  return {
    setInput(input) {
      const tape = tokenize(input, path, { tolerant });
      data = tape.data;
      this.tokens = tape.tokens;
      this.trivia = tape.trivia;
      this.source = tape.source;
      this.lexDiagnostics = tape.lexDiagnostics ?? [];
      this.payloads = tape.payloads;
      this.islandLineKeywords = tape.islandLineKeywords;
      this.index = 0;
      this.text = '';
      this.loc = null;
      this.token = null;
      this.implicit = tape.implicitOpeners;
      this.nextId = tape.nextId;
      this.early = null;
    },
    lex() {
      let t = this.tokens[this.index];
      if (this.early !== null) {
        while (t && this.staleCloser(t, null)) {
          this.tokens.splice(this.index, 1);
          t = this.tokens[this.index];
        }
      }
      if (!t) return null;
      this.index++;
      this.text = t.value;
      this.loc = { start: t.start, end: t.end };
      this.token = t;
      return t.kind;
    },
    payload() {
      return this.payloads.get(this.token) ?? null;
    },
    // parse-error(t): where the parser cannot take the current token inside
    // implicit calls or objects the layout pass opened, the driver closes
    // the fewest of them that let it in. The tape stays what the parser
    // read: early closers are spliced in and the pass's stale ones out. A
    // payload is left as the passes built it, its stale closers skipped as
    // they are read. `payload` and `at` locate the current token inside an
    // entry's payload; without them it is the tape's last token read.
    cursor(eof, payload, at) {
      const tape = payload ?? this.tokens;
      return [tape, eof ? tape.length : payload ? at : this.index - 1];
    },
    // The open implicit constructs, innermost first. An implicit closer is
    // the same terminal as an explicit one, so the list stops at the first
    // open bracket the pass did not open: closing past it would close it.
    // None closes in front of a closer, nor when the innermost holds no
    // real token yet (an empty call or object the user never wrote), nor
    // after a comma, which promised another argument (`f a, < b` is
    // broken, never `f(a) < b`).
    implicitOpeners(eof, payload = null, at = 0) {
      const [tape, end] = this.cursor(eof, payload, at);
      const open = [];
      if (!eof && NESTING[tape[end].kind] === -1) return open;
      let last = end - 1;
      while (last >= 0 && tape[last].generated) last--;
      if (last >= 0 && tape[last].kind === ',') return open;
      let depth = 0, written = false;
      for (let j = end - 1; j >= 0; j--) {
        const t = tape[j];
        if (!t.generated) written = true;
        const n = NESTING[t.kind];
        if (n === undefined || this.early?.skip.has(t)) continue;
        if (n === -1) depth++;
        else if (depth > 0) depth--;
        else if (!this.implicit.has(t) || !written) return open;
        else open.push(t);
      }
      return open;
    },
    // The closers for `openers` (innermost first), zero-width at the end of
    // the last real token, as the pass anchors its own; or null when the
    // outermost one's stale span holds a comma at its own level. The pass
    // gave that comma to the construct while it was open, and the reading
    // it would get after the close (`g k: ok ? f a : b, c` making `c` a
    // shorthand key) is one nobody chose.
    closeImplicit(openers, eof, payload = null, at = 0) {
      const [tape, end] = this.cursor(eof, payload, at);
      this.early ??= { closed: new Set(), skip: new Set(), pairs: new Map() };
      if (!this.early.pairs.has(tape)) this.early.pairs.set(tape, pairImplicit(tape, this.implicit));
      const stale = this.early.pairs.get(tape).get(openers[openers.length - 1]);
      for (let j = end, depth = 0; j < tape.length && tape[j] !== stale; j++) {
        const n = NESTING[tape[j].kind];
        if (n !== undefined) depth += n;
        else if (tape[j].kind === ',' && depth <= 0) return null;
      }
      let last = null;
      for (let j = end - 1; j >= 0 && last === null; j--) if (!tape[j].generated) last = tape[j];
      const closers = openers.map((opener) => {
        const call = opener.kind === 'CALL_START';
        const closer = {
          id: this.nextId++,
          kind: call ? 'CALL_END' : '}', value: call ? ')' : '}',
          start: last ? last.end : 0, end: last ? last.end : 0,
          spaced: false, newLine: false, generated: true, origin: last ? last.id : null,
        };
        this.early.closed.add(opener);
        this.early.skip.add(opener).add(closer);
        return closer;
      });
      if (payload === null) {
        this.tokens.splice(end, 0, ...closers);
        if (!eof) this.index += closers.length;
      }
      return closers;
    },
    staleCloser(t, payload) {
      if (NESTING[t.kind] !== -1 || !this.early.closed.has(this.early.pairs.get(payload ?? this.tokens)?.get(t))) return false;
      this.early.skip.add(t);
      return true;
    },
    // A rejection inside a schema body's payload: the schema reader names
    // what the line needed (null keeps the parser's own message). Inside a
    // member's body, a `catch` or `finally` line at the member's own depth
    // that the parse rejects closes no `try`: it is a field written below
    // the member, which the line cannot be.
    explain(token, payload, at) {
      if (token?.kind === 'SCHEMA_BODY') return explainSchemaReject(payload, at);
      const t = payload?.[at];
      if (token?.kind === 'SCHEMA_CODE' && (t?.kind === 'CATCH' || t?.kind === 'FINALLY') && this.islandLineKeywords.has(t.id)) {
        const word = t.value;
        return {
          message: `a \`${word}\` line after a member's body continues that body, closing no \`try\` — a field named \`${word}\` goes above the member, and code continuing the body is indented`,
          start: t.start,
          end: t.end,
        };
      }
      return null;
    },
    // The parse accepted: each schema's descriptor is read from its tree.
    finish(result) {
      finishSchemas(result, this.source, path, tolerant);
    },
    dataSection() {
      return data;
    },
  };
}
