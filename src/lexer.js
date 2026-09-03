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
import { TEMPLATE_TAGS } from './dom.js';
import { counter, syncCounterFlag } from './counter.js';
// The identifier character classes; the scanner walks characters, so it
// takes the classes rather than the helpers built on them.
import { IDENT_START, IDENT_PART } from './ident.js';
// The three insertion passes; each applies itself. The retag passes
// (tagParams, tagDynamicKeys, tagVoidMarkers, tagCompoundKeys,
// tagPostfixConditionals) stay here — they never add tokens.
import {
  implicitBlocks, implicitObjects, implicitCalls,
  PASS_OPENERS, PASS_CLOSERS,
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
// A retag pass takes the finished TokenTape and changes token KINDS in
// place — never inserts or deletes records — so tape indices and origins
// stay stable by construction. Passes that add tokens are collectors
// applied through the insertion-pass runner in ./implicit.js, never
// direct mutators.

// Arrow-function parameter tagging: when
// an arrow follows a `)`, the matching plain `(` … `)` pair retags to
// PARAM_START … PARAM_END. A CALL_START match means the parens belong to
// a call — the arrow is parameterless and nothing retags. A DO directly
// before the function (its arrow, or its param list's opener) retags to
// DO_IIFE — `do ->` and `do (x) ->` are the immediate-invocation forms.
export function tagParams(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    if (counter.on) counter.n++;
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
    if (counter.on) counter.n++;
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
        if (counter.on) counter.n++;
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

// Commaless call arguments: inside a call, an arrow directly after a
// completed LITERAL argument reads as the next argument — the comma
// is implied: `get '/users' -> handler` is `get('/users', handler)`.
// The splice is a zero-width ',' at the arrow's start (a synthesized
// separator, the zero-width row discipline). Identifier-ended
// arguments do NOT trigger (`f x -> 1` keeps its reading: x called
// with the function? no — x is not a literal; explicit comma rules).
const ARROW_COMMA_AFTER = new Set([
  'STRING', 'STRING_END', 'REGEX', 'HEREGEX_END', 'NUMBER',
  'BOOL', 'NULL', 'UNDEFINED', ']', '}', 'SYMBOL',
]);
export function insertArrowCommas(tokens) {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (counter.on) counter.n++;
    const k = tokens[i].kind;
    if (k === 'CALL_START') depth++;
    else if (k === 'CALL_END') depth--;
    else if (depth > 0 && (k === '->' || k === '=>') && i > 0 &&
             (ARROW_COMMA_AFTER.has(tokens[i - 1].kind) ||
              (tokens[i - 1].kind === 'IDENTIFIER' &&
               (tokens[i - 1].value === 'Infinity' || tokens[i - 1].value === 'NaN')))) {
      tokens.splice(i, 0, { kind: ',', value: ',', start: tokens[i].start, end: tokens[i].start });
      i++;
    }
  }
  return tokens;
}

// Compound object keys: an IDENTIFIER/PROPERTY chain joined by `.`
// (any spacing) or `-` (tight on both sides — spaced subtraction and
// line-broken expressions keep their readings) and followed directly
// by `:` is ONE string key: `{ data-src: 1 }`, `{ www.amazon.com: 4 }`,
// `{ beta-site.amazon.com: 2 }`. The chain collapses to a STRING token
// spanning the written chain; the value concatenates the parts
// (spacing around dots drops). A ternary's `:` never claims —
// `a ? b.c : d` keeps its member read — the same pending-ternary
// discipline as tagDynamicKeys.
export function tagCompoundKeys(tokens) {
  const OPENERS = new Set(['(', '[', '{', 'PICK_START', 'OPTPICK_START', 'CALL_START', 'INDEX_START', 'PARAM_START', 'STRING_START', 'INTERPOLATION_START', 'HEREGEX_START', 'INDENT']);
  const CLOSERS = new Set([')', ']', '}', 'PICK_END', 'CALL_END', 'INDEX_END', 'PARAM_END', 'STRING_END', 'INTERPOLATION_END', 'HEREGEX_END', 'OUTDENT']);
  const identish = (x) => x !== undefined && (x.kind === 'IDENTIFIER' || x.kind === 'PROPERTY');
  const pendingTernary = [0];
  for (let i = 0; i < tokens.length; i++) {
    if (counter.on) counter.n++;
    const k = tokens[i].kind;
    if (k === 'TERNARY') {
      pendingTernary[pendingTernary.length - 1]++;
    } else if (k === ':' || k === 'TERMINATOR') {
      const top = pendingTernary.length - 1;
      if (k === 'TERMINATOR') pendingTernary[top] = 0;
      else if (pendingTernary[top] > 0) pendingTernary[top]--;
    } else if (identish(tokens[i]) && pendingTernary[pendingTernary.length - 1] === 0 &&
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
// decides — the LALR table cannot (an `Identifier . DAMMIT` state would
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
    if (counter.on) counter.n++;
    if (tokens[i].kind !== 'DAMMIT') continue;
    if (tokens[i + 1]?.kind === '=' ||
        (tokens[i - 1]?.kind === 'IDENTIFIER' && tokens[i - 2]?.kind === 'DEF')) {
      tokens[i].kind = 'VOID_MARKER';
    }
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
export const ALIASES = {
  __proto__: null,
  and: ['&&', '&&'],
  or: ['||', '||'],
  not: ['UNARY', '!'], // word-not is UNARY; symbol ! is UNARY_MATH
  new: ['NEW', 'new'], // dedicated token: the grammar owns the new/member split
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

// Value-ending token kinds that can HEAD a tagged template: a string
// right against one of these (or bridged by `$`) is `tag\`…\``, never
// a call argument.
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
  // `~>` is the reactive effect head everywhere the main
  // grammar sees it; inside a schema body the same token spells a
  // computed getter (the schema sub-parser consumes it before
  // the grammar runs). `!>` (eager derived) exists only in schema
  // bodies — a stray one is a loud parse error. Both scan as single
  // tokens so a trailing one never reads as a line-continuing COMPARE.
  '~>': 'EFFECT', '!>': '!>',
  // The match operator: `text =~ /re/` — comparison-tier precedence,
  // deliberately non-chaining (the emitter rejects a bare chain).
  '=~': 'MATCH',
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
  '.', '?.', 'UNARY', 'NEW', 'DO', 'DO_IIFE', 'MATH', 'UNARY_MATH', '+', '-', '**', 'SHIFT',
  'RELATION', 'COMPARE', '&', '^', '|', '&&', '||', '??', 'TERNARY', 'EXTENDS',
]);

// Token kinds after which '(' opens a call rather than a grouping.
// DAMMIT is callable: `f!(1, 2)` calls (and awaits) f. DYNAMIC_IMPORT
// exists only when a '(' or '!(' follows (the lexer mints it from that
// lookahead), so `import(url)` and `import!(url)` are real calls.
const CALLABLE = new Set(['IDENTIFIER', 'PROPERTY', ')', 'CALL_END', 'NUMBER', 'STRING', ']', 'INDEX_END', 'SUPER', 'DAMMIT', 'PRESENCE', 'DYNAMIC_IMPORT']);

// Token kinds after which an unspaced '[' indexes rather than opening an
// array literal (the scan-time rule: !prev.spaced && INDEXABLE.has(prev)).
// THIS and '@' index (`this[k]`, `@[k]`); an INDEX pair that turns out to
// be a dynamic KEY retags to plain brackets in tagDynamicKeys.
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
  // Open ternaries during the scan: a pending `?` claims the next
  // bare `:` as its ELSE, so `c ? a :b` never mints a symbol there.
  let scanTernary = 0;
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
    if ((kind === 'STRING' || kind === 'STRING_START') && (seenImport || seenExport)) {
      const prevTok = tokens[tokens.length - 1];
      if (prevTok?.kind === 'IDENTIFIER' && prevTok.value === 'from') prevTok.kind = 'FROM';
    }
    // `yield from` — the delegation keyword pair: `from` right after
    // YIELD is the FROM token (contextual, like the module form).
    if (kind === 'IDENTIFIER' && value === 'from' && tokens[tokens.length - 1]?.kind === 'YIELD') {
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
        // the render grammar's to say, and it is not saying it here.
        if (inRender) return false;
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
      const dotCont = dotAt >= 0 && text[dotAt + 1] !== '.' && !DIGIT.test(text[dotAt + 1] ?? '') && !inRender;
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
      // classification: `when: 1` and `if: 2` are pairs). Ternary
      // branches are guarded; `::` and `:=` never key — the
      // prototype operator and the reactive assign own those colons.
      // A SPACED colon tight to a following word is a SYMBOL, never a
      // key (`a is :b`, `schema :model` — the schema-kind rule
      // generalized); a tight colon (`when: 1`) or a spaced colon with
      // a spaced value (`{a : b}`) keys as before.
      const afterWord = text.slice(pos);
      const tightColon = /^:(?![=:])/.test(afterWord);
      const spacedColon = /^[^\S\n]+:(?![=:])/.exec(afterWord);
      const symbolish = spacedColon !== null && IDENT_START.test(afterWord[spacedColon[0].length] ?? '');
      const keysColon = (tightColon || (spacedColon !== null && !symbolish)) && prev?.kind !== 'TERNARY';
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
        } else if (word === 'new' && text[pos] === '.' && /^\.target\b/.test(text.slice(pos))) {
          // `new.target` heads a meta-property member (the
          // import.meta precedent); a bare `new.` anything else keeps
          // its UNARY reading and rejects at the parser.
          push('NEW_TARGET', 'new', start, pos);
        } else {
          // Type text owns the `is` predicate spelling; the source word
          // rides with rewritten tokens so collectTypeRun can preserve
          // it only in the admitted predicate position.
          push(kind, value, start, pos, { word });
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
      // A string RIGHT AGAINST a value token (no gap) is a tagged
      // template: `tag"x"`, `obj.fn"x"`, `f(1)"x"`. The zero-width
      // TEMPLATE_TAG marks the boundary; a SPACED string keeps its
      // implicit-call reading (`tag "x"` → tag("x")). The tight
      // spelling was a parse error before this claim.
      const prevTok = tokens[tokens.length - 1];
      if (prevTok && TAGGABLE.has(prevTok.kind) && prevTok.end === pos) {
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
      if (ch === '*' && seenImport && (last()?.kind === 'IMPORT' || last()?.kind === 'IMPORT_TYPE' || last()?.kind === ',')) push('IMPORT_ALL', ch, pos, pos + 1);
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
      // check when bare (`a?!` → `a ? true : undefined`) and maybe
      // dammit when followed by arguments (`f?!(x)` → `await f?.(x)`),
      // and a '?' directly after a value-ending token is the postfix
      // existence check (`a?` → `a != null`) — real tokens and nodes.
      // A juxta argument after that existence token (`f? x`) is an
      // optional call: `?` is IMPLICIT_FUNC, so implicitCalls wraps the
      // args and the grammar lowers `Value ? Arguments` to optcall
      // (same as `f?(x)`). Bare `a?` with no juxta arg stays existence.
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
      scanTernary++;
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
    // Symbol literals: `:name`, `:domain.name`, `:kebab-name`, and a
    // single trailing `!`/`?` (`:save!`, `:valid?`, claimed only at a
    // clear boundary — symbolNameEnd) become one interned name — only
    // where the
    // colon CANNOT be structural: after a value-ending token the
    // colon is a key/annotation/ternary colon (`{a:b}`, `x:number`,
    // `c ? a :b` all keep their readings), and a schema HEAD's kind
    // (`schema :model`) follows an identifier, so it never mints
    // (schema BODY symbols mint and split back inside rewriteSchema).
    // Type bodies use colons structurally and never mint.
    if (ch === ':' && IDENT_START.test(text[pos + 1] ?? '') &&
        !insideTypeBody() && !aliasHeadOpen()) {
      const prevTok = tokens[tokens.length - 1];
      const structural = prevTok !== undefined && (
        prevTok.kind === 'PROPERTY' ||
        prevTok.kind === ')' || prevTok.kind === ']' || prevTok.kind === '}' ||
        prevTok.kind === 'CALL_END' || prevTok.kind === 'INDEX_END' ||
        prevTok.kind === 'PARAM_END' || prevTok.kind === 'PICK_END' ||
        prevTok.kind === 'STRING' || prevTok.kind === 'STRING_END' ||
        prevTok.kind === 'NUMBER' || prevTok.kind === 'REGEX' ||
        prevTok.kind === 'HEREGEX_END' || prevTok.kind === 'BOOL' ||
        prevTok.kind === 'NULL' || prevTok.kind === 'UNDEFINED' ||
        prevTok.kind === 'DAMMIT' || prevTok.kind === '?' ||
        prevTok.kind === 'PRESENCE' || prevTok.kind === 'OPT_MARKER' ||
        prevTok.kind === 'THIS' || prevTok.kind === '@' || prevTok.kind === 'SYMBOL' ||
        // A pending ternary's ELSE colon: after a bare identifier the
        // colon closes the ternary (`c ? d :e`); after `?` or another
        // colon the branch NEEDS a value, so `:yes` mints
        // (`c ? :yes : :no`).
        (scanTernary > 0 && prevTok.kind === 'IDENTIFIER'));
      if (!structural) {
        const end2 = symbolNameEnd(text, pos + 1);
        push('SYMBOL', text.slice(pos + 1, end2), pos, end2);
        pos = end2;
        continue;
      }
    }
    if (ch === '=' || ch === '+' || ch === '-' || ch === '.' || ch === ',' || ch === ';' || ch === ':') {
      if (ch === ':' && scanTernary > 0) scanTernary--;
      push(ch === ';' ? 'TERMINATOR' : ch, ch, pos, pos + 1);
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
  rewriteSchema(tokens, mintId, text, fail, tolerant
    ? (err) => lexDiagnostics.push({
        message: err.reason ?? String(err.message), start: err.start ?? 0,
        end: err.end ?? err.start ?? 0, expected: [], got: '',
      })
    : null);
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
  // Compound keys collapse AFTER render rewriting (a render block's
  // hyphenated class chains are render grammar, never object keys)
  // and BEFORE the implicit-structure passes (the collapsed STRING
  // must be the key implicitObjects reads).
  tagCompoundKeys(tokens);
  implicitBlocks(tokens, mintId);
  tagPostfixConditionals(tokens);
  implicitObjects(tokens, mintId);
  implicitCalls(tokens, mintId);
  insertArrowCommas(tokens);

  return { tokens, trivia, source, lexDiagnostics };
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
export function makeParserLexer(path = '<anonymous>', { tolerant = false } = {}) {
  return {
    setInput(input) {
      const tape = tokenize(input, path, { tolerant });
      this.tokens = tape.tokens;
      this.trivia = tape.trivia;
      this.source = tape.source;
      this.lexDiagnostics = tape.lexDiagnostics ?? [];
      this.index = 0;
      this.text = '';
      this.loc = null;
      this.token = null;
    },
    lex() {
      const t = this.tokens[this.index];
      if (!t) return null;
      this.index++;
      this.text = t.value;
      this.loc = { start: t.start, end: t.end };
      this.token = t;
      return t.kind;
    },
  };
}
