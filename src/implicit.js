// Implicit structure — the three INSERTION passes, and the runner that
// applies them. Everything here ADDS tokens to a finished tape; the
// retag passes, which only change kinds in place, stay in lexer.js.
// That is the line this file is cut along.
//
// `tokenize` runs these in order (blocks, then postfix-conditional
// retagging, then objects, then calls); the ordering constraints are
// documented with the pipeline in lexer.js, not here.
//
// Each exported pass APPLIES itself. The collector/runner split below
// is real and load-bearing — a collector returns `{at, token}` records
// against ORIGINAL indices, so a mid-walk splice would invalidate every
// subsequent `at` — but it is an implementation detail, so the runner
// and the collectors are module-private and callers just run the pass.

import { counter } from './counter.js';

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
function applyInsertions(tokens, collect, mintId) {
  const insertions = collect(tokens, mintId);
  if (insertions.length === 0) return tokens;
  let read = tokens.length - 1;
  let ins = insertions.length - 1;
  tokens.length += insertions.length;
  for (let write = tokens.length - 1; write >= 0; write--) {
    if (counter.on) counter.n++;
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
function collectBlocks(tokens, mintId) {
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
      if (counter.on) counter.n++;
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
      if (counter.on) counter.n++;
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
      if (counter.on) counter.n++;
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
      if (counter.on) counter.n++;
      if (!tokens[j].generated) { firstReal = tokens[j]; break; }
    }
    let lastReal = null;
    for (let j = end - 1; j >= start; j--) {
      if (counter.on) counter.n++;
      if (!tokens[j].generated) { lastReal = tokens[j]; break; }
    }
    // The first real token after the body — the OUTDENT's origin. Bounded
    // scan: a whole-tail slice here is O(tape) per body, quadratic overall.
    let afterReal = null;
    for (let j = end; j < tokens.length; j++) {
      if (counter.on) counter.n++;
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
    if (counter.on) counter.n++;
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
// are the exception — like `+` they continue the argument and never
// close the call, so `f a, b or c` reads `f(a, b or c)`), at any
// enclosing closer, at INDENT unless the previous
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
// Postfix existence `?` and maybe dammit `?!` are callable the same
// way DAMMIT is: a spaced argument after either opens an implicit call
// (`f? x` is optional; `f?! x` also awaits). Without an argument the
// tokens keep their postfix operations: existence for `?`, presence for
// `?!`. The grammar productions own both forks.
const IMPLICIT_FUNC = new Set(['IDENTIFIER', 'PROPERTY', 'SUPER', ')', 'CALL_END', ']', 'INDEX_END', '@', 'THIS', 'DAMMIT', '?', 'PRESENCE']);
const IMPLICIT_CALL_STARTERS = new Set([
  'IDENTIFIER', 'PROPERTY', 'NUMBER', 'STRING', 'STRING_START', 'REGEX', 'HEREGEX_START', 'SYMBOL', 'MAP_START',
  'PARAM_START', 'IF', 'TRY', 'SWITCH', 'CLASS', 'THIS', 'SUPER',
  'UNDEFINED', 'NULL',
  'BOOL', 'UNARY', 'NEW', 'DO', 'DO_IIFE', 'UNARY_MATH', 'AWAIT', 'YIELD', 'THROW', '@', '->', '=>', '[', '(', '{',
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
// The bracket-nesting vocabulary these passes track. Exported because
// tagPostfixConditionals in lexer.js walks the same nesting — it runs
// BETWEEN implicitBlocks and implicitObjects and reads the depth they
// establish. Kept here, with its users, rather than copied there.
export const PASS_OPENERS = new Set(['(', '[', '{', 'PICK_START', 'OPTPICK_START', 'CALL_START', 'INDEX_START', 'PARAM_START', 'STRING_START', 'INTERPOLATION_START', 'HEREGEX_START', 'INDENT']);
export const PASS_CLOSERS = new Set([')', ']', '}', 'PICK_END', 'CALL_END', 'INDEX_END', 'PARAM_END', 'STRING_END', 'INTERPOLATION_END', 'HEREGEX_END', 'OUTDENT']);

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
  // Infinity and NaN are value LITERALS spelled as identifiers — they
  // never head a call, so an arrow after one is the NEXT argument
  // (`handle Infinity -> fn` — the commaless bridge), never a callee.
  if (t.kind === 'IDENTIFIER' && (t.value === 'Infinity' || t.value === 'NaN') &&
      (next.kind === '->' || next.kind === '=>')) return false;
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
      if (counter.on) counter.n++;
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
    if (counter.on) counter.n++;
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
// objectContinues below). That exception is gated on startsLine for the
// same reason the TERMINATOR rule below is: objectContinues looks PAST a
// line break, and only a line-starting object may span one. A key that
// opens an implicit call is never line-starting, so in `f a: 1 if c` the
// guard belongs to the STATEMENT — without the gate, a following
// `x: 1` line (an implicit-return object, say) made the pair look like a
// continuing property list and the guard collapsed into the argument as
// `f({a: c ? 1 : undefined})`, calling f unconditionally with undefined;
// multi-line objects (startsLine) stay open
// across TERMINATOR while the next line looks objectish; a comma whose
// next element is not objectish closes (`x = a: 1, b` is an object
// then a syntax error) — but a TRAILING comma before an indented
// objectish line CONTINUES the list (`f x: 1,` + indent + `y: 2` is
// one object), where CoffeeScript would start a second one and hand it
// to the call as an extra argument nobody wrote a parameter for;
// enclosing closers and INDENT (unless
// the previous token is `:` — an indented VALUE — a block-argument
// carrier — or an IMPLICIT_FUNC whose indented body looks objectish,
// the pending indented-object call the call pass will wrap) close;
// end of tape closes. CONTROL_IN_IMPLICIT frames shield an object
// from a control construct's block INDENT exactly as in the call
// pass. Inserted `{`/`}` are zero-width generated tokens:
// `{` anchored at the key's start (origin = the key), `}` at the last
// real token's end (origin = that token) — object spans in
// NodeStore/MappingStore are the real source extent by construction.
function collectObjects(tokens, mintId) {
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
  // Index of a comma that kept its property list open for an indented
  // continuation line; the very next INDENT consumes it.
  let continuationComma = -1;

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

  // The open property list, seen THROUGH the INDENT frames that earlier
  // trailing-comma continuations pushed (`a: 1,` / indent / `b: 2,` /
  // indent / `c: 3`). Those INDENTs are transparent to the list: the
  // pairs under them belong to the object below, so the comma and `:`
  // rules have to look past them to find the frame they act on.
  const listObjectFrame = () => {
    for (let d = stack.length - 1; d >= 0; d--) {
      if (counter.on) counter.n++;
      const fr = stack[d];
      if (fr.kind === 'object') return fr;
      if (!(fr.kind === 'INDENT' && fr.listContinuation)) return null;
    }
    return null;
  };

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
  // Pending indented-object call: `f` + INDENT + `key:` body. The call
  // pass inserts CALL_START before that INDENT; objects-first must keep
  // the outer object open and treat keys under the INDENT as the call
  // argument's nested object (`a: source` / indent / `fetch:`).
  const pendingIndentedObjectCallAt = (indentAt) => {
    const before = tokens[indentAt - 1];
    return Boolean(
      before &&
      IMPLICIT_FUNC.has(before.kind) &&
      looksObjectish(indentAt + 1) &&
      !controlHeadBackwards(tokens, indentAt - 1),
    );
  };

  const openCallBetween = (from, i) => {
    let levels = 0;
    for (let j = i - 1; j > from; j--) {
      if (counter.on) counter.n++;
      const k = tokens[j].kind;
      if (PASS_CLOSERS.has(k)) { levels++; continue; }
      if (PASS_OPENERS.has(k)) {
        if (k === 'INDENT' && levels === 0) {
          // A level-0 INDENT ends in-scope spaced calls — unless it is
          // the indented-object call argument (callee before INDENT).
          return pendingIndentedObjectCallAt(j);
        }
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
      if (counter.on) counter.n++;
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
    if (counter.on) counter.n++;
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
      // value is the indented block), a block-argument carrier, or a
      // pending indented-object call (`user: source` + indent + pairs)
      // — and consumes the CONTROL frame whose block this is.
      if (prev && !BLOCK_ARG_CARRIERS.has(prev.kind) && !pendingIndentedObjectCallAt(i)) {
        while (top()?.kind === 'object' && prev.kind !== ':') closeObject(i);
      }
      if (top()?.kind === 'CONTROL') stack.pop();
      // A trailing comma before this INDENT means the indented pairs
      // CONTINUE the open property list rather than starting a fresh
      // object (the trailing-comma continuation; see the `,` rule).
      const listContinuation = continuationComma === i - 1 && Boolean(listObjectFrame());
      stack.push({ kind: 'INDENT', at: i, listContinuation });
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
      // (`x = a: 1, b: f 2, c: 3` is {a: 1, b: f(2, {c: 3})};
      // `a: source` + indent + `fetch:` is the indented-object form).
      const f = top();
      const under = stack[stack.length - 2];
      const isBraceFrame = (fr) => fr && (fr.kind === '{' || fr.kind === 'PICK_START' || fr.kind === 'OPTPICK_START' || fr.kind === 'object');
      const isBraceKind = (kd) => kd === '{' || kd === 'PICK_START' || kd === 'OPTPICK_START';
      // When the top frame is an INDENT under a brace, search from the
      // brace — openCallBetween's walk starts after `from`, so starting
      // at the INDENT itself would never see the callee before it.
      const listFrame = f?.kind === 'INDENT' && f.listContinuation ? listObjectFrame() : null;
      const underContinuedList = Boolean(listFrame);
      const callFrom = listFrame ? listFrame.at : (f?.kind === 'INDENT' && under) ? under.at : f?.at;
      if (f && (isBraceFrame(f) || (f.kind === 'INDENT' && (isBraceKind(under?.kind) || underContinuedList))) &&
          !(callFrom != null && openCallBetween(callFrom, s)) &&
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
              !((k === 'POST_IF' || k === 'POST_UNLESS') && fr.startsLine && objectContinues(i + 1))) closeObject(i);
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
    //
    // A TRAILING comma before an indented objectish line is the one
    // other exception: those pairs continue THIS list. Closing here
    // instead (CoffeeScript's reading) makes the indented pairs a
    // second argument, so for the single-options-object call the form
    // is written as, the continuation line vanishes at run time with
    // no error anywhere. Left to the INDENT rule from there — `,` is
    // a block-argument carrier, so the frame already survives — and to
    // the `:` rule, which reads keys under a continuation INDENT as
    // pairs of the object below it.
    if (k === ',') {
      const list = listObjectFrame();
      if (list && !openCallBetween(list.at, i) &&
          !looksObjectish(i + 1) &&
          (tokens[i + 1]?.kind !== 'TERMINATOR' || !looksObjectish(i + 2))) {
        if (tokens[i + 1]?.kind === 'INDENT' && looksObjectish(i + 2)) {
          continuationComma = i;
        } else if (top()?.kind === 'object') {
          const offset = tokens[i + 1]?.kind === 'OUTDENT' ? 1 : 0;
          while (top()?.kind === 'object') closeObject(i + offset);
        }
        // Otherwise the list is open UNDER a continuation INDENT and
        // there is nothing to close here — the OUTDENT/TERMINATOR that
        // ends the continuation closes it, as it already does.
      }
    }
  }

  if (tokens.length && !tokens[tokens.length - 1].generated) lastReal = tokens[tokens.length - 1];
  while (top()?.kind === 'object' || top()?.kind === 'CONTROL') {
    if (top().kind === 'object') closeObject(tokens.length);
    else stack.pop();
  }
  return insertions;
}

function collectCalls(tokens, mintId) {
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
    if (counter.on) counter.n++;
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
      // Logical operators never close an implicit call — the operator
      // binds its operand into the argument (`f a, b or c` reads
      // `f(a, b or c)`), exactly as they bind a pair's value in the
      // object pass. They are ordinary continuing operators like `+`.
      if (k === '||' || k === '&&' || k === '??') continue;
      if (tokens[i - 1]?.kind !== ',') {
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

// The pipeline surface: one call per pass, applied in place.
export const implicitBlocks = (tokens, mintId) => applyInsertions(tokens, collectBlocks, mintId);
export const implicitObjects = (tokens, mintId) => applyInsertions(tokens, collectObjects, mintId);
export const implicitCalls = (tokens, mintId) => applyInsertions(tokens, collectCalls, mintId);
