// Lint rules over the SHAPE of a compiled source: the token tape and the
// node spans a compile already produced, never a second parse and never the
// generated code. `rip lint` runs them; nothing here touches the type face.
//
// The grammar has one `call` rule for every spelling, so the node cannot say
// how a call was written. The tape can: the implicit-call pass mints a
// zero-width CALL_START with `generated: true` at the first argument, and
// the implicit-object pass mints a generated `{` at the first pair. A call's
// `args` role span opens exactly on its CALL_START, and an object's span on
// its `{`, so one lookup by offset decides each form.
//
// A finding's `edits` rewrite the author's bytes at recorded offsets, so
// comments and layout outside the edits survive untouched. Whether a
// rewrite is SAFE is the caller's to prove by recompiling.

// Each rule's accepted values: a rule names its subject, and its value names
// the spelling it requires. A rule the block leaves out is off.
const RULES = { calls: ['explicit'], construction: ['.new'], await: ['dammit'], dammit: ['bare'] };
const CALL_KINDS = new Set(['call', 'optcall', 'maybe-dammit', 'super']);

// The validated rule set for a package's `rip.lint` block, or null when the
// package sets none. Malformed input rejects naming the key: a misspelled
// rule that read as "off" would be the silent kind of tolerance.
export function lintRulesOf(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('rip.lint: expected an object');
  const rules = Object.fromEntries(Object.keys(RULES).map((key) => [key, null]));
  for (const [key, value] of Object.entries(raw)) {
    const accepted = RULES[key];
    if (!Object.hasOwn(RULES, key)) throw new Error(`rip.lint: unknown rule \`${key}\``);
    if (!accepted.includes(value)) throw new Error(`rip.lint.${key}: expected ${accepted.map((v) => `"${v}"`).join(' or ')}`);
    rules[key] = value;
  }
  return rules;
}

// Findings in source order: { rule, start, end, message, edits }. `edits`
// is null when the shape has no rewrite.
//
// `calls: 'explicit'`: every call with arguments is spelled with parentheses
// and every object argument with braces. A call whose last argument opens a
// block on the lines below keeps the implicit form, whether the block is a
// function body (`run ->`), keyword pairs (`http.create` with `retry: 0` on
// the next line), a heredoc (`sql! """`), or an implicit call that itself
// ends in one (`count db.sql! """`): the block closes the argument. A render
// tree is template, not code, except inside a handler body.
//
// `construction: '.new'`: `X.new(a)`, never `new X(a)`. `await: 'dammit'`:
// a call is awaited with dammit, `f!(a)` for `await f(a)`; a written `await`
// is for a promise already in hand. `dammit: 'bare'`: a dammit call without
// arguments is `f!`, never `f!()`.
export function lintFindingsOf(tokens, stores, source, rules) {
  if (!rules || !Object.values(rules).some((v) => v) || !tokens || !stores) return [];
  const parents = parentsOf(stores);
  const children = childrenOf(stores, parents);
  const depthOf = (id) => { let d = 0; for (let p = parents.get(id); p !== undefined; p = parents.get(p)) d++; return d; };
  const real = tokens.filter((t) => !t.generated && typeof t.start === 'number');
  const at = new Map();
  for (const t of tokens) {
    if (typeof t.start !== 'number') continue;
    const list = at.get(t.start);
    if (list) list.push(t); else at.set(t.start, [t]);
  }
  const tokenAt = (offset, kind, generated) => (at.get(offset) ?? []).find((t) => t.kind === kind && t.generated === generated) ?? null;
  const lastRealEndBefore = (offset) => {
    let end = null;
    for (const t of real) { if (t.end > offset) break; end = t.end; }
    return end;
  };

  const implicitObject = (c) => c.semanticKind === 'object' && tokenAt(c.sourceStart, '{', true) !== null;
  const opensOwnLine = (c) => source.slice(source.lastIndexOf('\n', c.sourceStart - 1) + 1, c.sourceStart).trim() === '';
  const argNodesOf = (call, args) => (children.get(call.nodeId) ?? []).filter((c) => c.sourceStart >= args.sourceStart && c.sourceEnd <= args.sourceEnd);
  // Whether an implicit call's last argument closes on a block. A keyword
  // block counts by where it opens, not how long it is: one pair on its own
  // line below the call is as much a block as ten. A last argument that is
  // itself an implicit call ending in a block ends there too, so the block
  // closes every call in the chain (`count db.sql! """`).
  const blockEnds = new Map();
  const endsInBlock = (call) => {
    if (blockEnds.has(call.nodeId)) return blockEnds.get(call.nodeId);
    const args = stores.role(call.nodeId, 'args');
    let ends = false;
    if (CALL_KINDS.has(call.semanticKind) && args && args.sourceStart !== args.sourceEnd && tokenAt(args.sourceStart, 'CALL_START', true) !== null) {
      const argNodes = argNodesOf(call, args);
      const last = argNodes[argNodes.length - 1];
      ends = trailingHeredoc(tokens, source, args) ||
        (last !== undefined && last.sourceEnd === args.sourceEnd &&
          ((last.semanticKind === 'func' && source.slice(last.sourceStart, last.sourceEnd).includes('\n')) ||
            (implicitObject(last) && opensOwnLine(last)) ||
            endsInBlock(last)));
    }
    blockEnds.set(call.nodeId, ends);
    return ends;
  };

  const found = [];
  for (const node of rules.calls ? stores.nodes : []) {
    if (!CALL_KINDS.has(node.semanticKind)) continue;
    const args = stores.role(node.nodeId, 'args');
    if (!args || args.sourceStart === args.sourceEnd) continue;
    const implicit = tokenAt(args.sourceStart, 'CALL_START', true) !== null;
    if (!implicit && tokenAt(args.sourceStart, 'CALL_START', false) === null) continue;
    if (inRenderTree(node, parents, stores)) continue;

    const argNodes = argNodesOf(node, args);
    const last = argNodes[argNodes.length - 1];
    const trailingBlock = implicit && endsInBlock(node);
    const objects = argNodes.filter((c) => implicitObject(c) && !(trailingBlock && c === last));
    const parenthesize = implicit && !trailingBlock;
    if (!parenthesize && objects.length === 0) continue;

    const depth = depthOf(node.nodeId);
    const edits = [];
    let fixable = true;
    // The source the finding stands on: the call, or the grouping parens
    // around it when the fix drops them.
    let span = [node.sourceStart, node.sourceEnd];
    // The paren replaces the gap between the callee's last real token and
    // the first argument, keeping an operator such as `?` or `?!` ahead of
    // it. A gap that breaks the line belongs to an indented block, which is
    // exempt above; any other shape that breaks there has no rewrite.
    const parenAt = parenthesize ? lastRealEndBefore(args.sourceStart) : null;
    if (parenthesize && source.slice(parenAt, args.sourceStart).includes('\n')) fixable = false;
    else if (parenthesize) {
      if (soleParenGroup(tokens, args)) {
        edits.push({ start: parenAt, end: args.sourceStart, text: '', rank: 0 });
      } else {
        edits.push({ start: parenAt, end: args.sourceStart, text: '(', rank: 1000 + depth });
        edits.push({ start: args.sourceEnd, end: args.sourceEnd, text: ')', rank: -depth });
        // A one-line function argument the author wrapped in parens only so
        // the implicit call would end its body at the comma: inside the
        // call's own parens the comma ends it already.
        for (const fn of argNodes) {
          if (fn.semanticKind !== 'func' || source.slice(fn.sourceStart, fn.sourceEnd).includes('\n')) continue;
          const group = enclosingGroup(tokens, source, fn);
          if (!group || group.open.start < args.sourceStart || group.close.end > args.sourceEnd) continue;
          edits.push({ start: group.open.start, end: group.open.end, text: '', rank: 0 });
          edits.push({ start: group.close.start, end: group.close.end, text: '', rank: 0 });
        }
      }
      // Grouping parens the author wrapped around the call are redundant
      // once the call carries its own. A group that is itself an enclosing
      // call's whole argument list becomes that call's parens, so it stays.
      const wrap = enclosingGroup(tokens, source, node);
      if (wrap && !isWholeArgs(wrap, node, parents, stores, tokenAt)) {
        edits.push({ start: wrap.open.start, end: wrap.open.end, text: '', rank: 0 });
        edits.push({ start: wrap.close.start, end: wrap.close.end, text: '', rank: 0 });
        span = [wrap.open.start, wrap.close.end];
      }
    }
    for (const obj of objects) {
      const objDepth = depthOf(obj.nodeId);
      const multiline = source.slice(obj.sourceStart, obj.sourceEnd).includes('\n');
      if (!multiline) {
        edits.push({ start: obj.sourceStart, end: obj.sourceStart, text: '{ ', rank: 1000 + objDepth, owner: obj.nodeId });
        edits.push({ start: obj.sourceEnd, end: obj.sourceEnd, text: ' }', rank: -objDepth, owner: obj.nodeId });
        continue;
      }
      // A multi-line object outside a trailing block is braced only as the
      // LAST argument of an explicit call. Its brace opens beside the paren
      // when it is the only argument, or after the comma that ends the line
      // before it, and closes beside the closing paren or on its own line at
      // the indentation of the line the call starts on.
      if (implicit) { fixable = false; continue; }
      const lineStart = source.lastIndexOf('\n', node.sourceStart - 1) + 1;
      const indent = /^[ \t]*/.exec(source.slice(lineStart))[0];
      const argsBodyEnd = args.sourceEnd - 1;
      const after = source.slice(obj.sourceEnd, argsBodyEnd);
      if (after.trim() !== '') { fixable = false; continue; }
      const lead = source.slice(args.sourceStart + 1, obj.sourceStart);
      const comma = /,([ \t]*\n\s*)$/.exec(lead);
      let openAt, openText;
      if (lead.trim() === '') { openAt = args.sourceStart + 1; openText = '{'; }
      else if (comma) { openAt = obj.sourceStart - comma[1].length; openText = ' {'; }
      else { fixable = false; continue; }
      edits.push({ start: openAt, end: openAt, text: openText, rank: 1000 + objDepth, owner: obj.nodeId });
      const closeOwnLine = after.includes('\n');
      edits.push(closeOwnLine
        ? { start: argsBodyEnd, end: argsBodyEnd, text: '}', rank: -objDepth, owner: obj.nodeId }
        : { start: obj.sourceEnd, end: obj.sourceEnd, text: `\n${indent}}`, rank: -objDepth, owner: obj.nodeId });
    }

    for (const e of edits) e.owner ??= node.nodeId;
    const lineEnd = source.indexOf('\n', span[0]);
    found.push({
      rule: 'calls',
      start: span[0],
      end: lineEnd === -1 ? span[1] : Math.min(span[1], lineEnd),
      kind: parenthesize ? 'implicit call' : 'keyword arguments without braces',
      node,
      span,
      edits: fixable ? edits : null,
    });
  }

  found.push(...spellingFindingsOf(stores, source, rules, { parents, depthOf, real, tokenAt, lastRealEndBefore }));
  for (const f of found) for (const e of f.edits ?? []) e.rule = f.rule;

  // Each message shows its own source with every fix it or a call inside it
  // owns applied, so a nested call reads as it will once the whole file is
  // fixed. Ownership, not position, decides: an enclosing call's closer can
  // sit at exactly this call's end. Another rule's rewrite strictly inside
  // the span applies too, wherever it is owned (`X.new(a)` for the call in
  // `new X a`). When the fix drops grouping parens, the
  // message names the text it replaces, since the fixed call alone would
  // read as if the parens stayed.
  const all = found.flatMap((f) => f.edits ?? []);
  const within = (owner, id) => { for (let n = owner; n !== undefined; n = parents.get(n)) if (n === id) return true; return false; };
  const quoted = (text) => {
    const lines = text.split('\n');
    return lines.length === 1 ? `\`${text}\`` : `\`${lines[0]}\` … \`${lines[lines.length - 1].trim()}\``;
  };
  return found.map(({ node, kind, span: [from, to], ...f }) => {
    if (f.edits === null) return { ...f, message: `${kind} — no automatic rewrite for this shape` };
    const inside = all.filter((e) => e.start >= from && e.end <= to &&
      (within(e.owner, node.nodeId) || (e.rule !== f.rule && e.start > from && e.end < to)))
      .map((e) => ({ ...e, start: e.start - from, end: e.end - from }));
    const original = source.slice(from, to);
    const replaced = from === node.sourceStart ? '' : ` in place of ${quoted(original)}`;
    return { ...f, message: `${kind} — write ${quoted(applyEdits(original, inside))}${replaced}` };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
}

// The construction, await, and dammit rules. Each rewrites one keyword or
// operator in place. `await new X(a)` has one owner, the await rule, which
// writes `X.new!(a)` whole; the construction rule leaves that `new` to it.
//
// `.new` and `!` insert where the callee's last real token ends, ahead of the
// calls rule's `(` at the same offset (`.new` before `!`). `.new()` after a
// bare constructor closes like a call, ahead of any enclosing closer there.
function spellingFindingsOf(stores, source, rules, { parents, depthOf, real, tokenAt, lastRealEndBefore }) {
  const found = [];
  const role = (id, name) => stores.role(id, name);
  const child = (id, name) => { const r = role(id, name); return r?.childNodeId == null ? null : stores.node(r.childNodeId); };
  const nextRealStart = (offset) => real.find((t) => t.start >= offset)?.start ?? offset;
  const isAwait = (n) => n?.semanticKind === 'await' && tokenAt(n.sourceStart, 'AWAIT', false) !== null;
  const isNew = (n) => n?.semanticKind === 'unary' && tokenAt(n.sourceStart, 'NEW', false) !== null;
  // A constructor the rewrite can name as a receiver: a plain identifier.
  // `a.B.new(c)` compiles to `new (a.B)(c)`, not to `new a.B(c)`.
  const plainCallee = (call) => {
    const callee = role(call.nodeId, 'callee');
    return callee && callee.childNodeId == null && tokenAt(callee.sourceStart, 'IDENTIFIER', false)?.end === callee.sourceEnd;
  };
  const plainOperand = (unary) => {
    const operand = role(unary.nodeId, 'operand');
    return operand && operand.childNodeId == null && tokenAt(operand.sourceStart, 'IDENTIFIER', false)?.end === operand.sourceEnd ? operand : null;
  };
  // `new X(a)` → `.new` at the callee's end; bare `new X` → `.new()` after
  // it, since `X.new` alone reads the property (`X.new!` constructs).
  const constructionEdits = (unary, suffix) => {
    const operand = child(unary.nodeId, 'operand');
    if (operand?.semanticKind === 'call' && plainCallee(operand)) {
      const args = role(operand.nodeId, 'args');
      return [{ start: lastRealEndBefore(args.sourceStart), text: `.new${suffix}`, rank: 1 }, ...(suffix ? emptyArgs(operand) : [])];
    }
    const bare = plainOperand(unary);
    return bare ? [{ start: bare.sourceEnd, text: suffix ? `.new${suffix}` : '.new()', rank: -depthOf(unary.nodeId) - 1 }] : null;
  };
  // The `()` an awaited call drops when the project writes dammit calls bare.
  const emptyArgs = (call) => {
    const args = role(call.nodeId, 'args');
    return rules.dammit && source.slice(args.sourceStart, args.sourceEnd) === '()' ? [{ start: args.sourceStart, end: args.sourceEnd, text: '', rank: 0 }] : [];
  };
  const push = (rule, kind, node, edits) => {
    for (const e of edits ?? []) { e.end ??= e.start; e.owner = node.nodeId; }
    const lineEnd = source.indexOf('\n', node.sourceStart);
    found.push({ rule, start: node.sourceStart, end: lineEnd === -1 ? node.sourceEnd : Math.min(node.sourceEnd, lineEnd), kind, node, span: [node.sourceStart, node.sourceEnd], edits });
  };

  for (const node of stores.nodes) {
    if (rules.construction && isNew(node) && !(rules.await && isAwait(stores.node(parents.get(node.nodeId) ?? -1)))) {
      const edits = constructionEdits(node, '');
      push('construction', 'prefix construction', node, edits && [{ start: node.sourceStart, end: nextRealStart(node.sourceStart + 3), text: '', rank: 0 }, ...edits]);
    }
    if (rules.await && isAwait(node)) {
      const value = child(node.nodeId, 'value');
      const drop = { start: node.sourceStart, end: nextRealStart(node.sourceStart + 5), text: '', rank: 0 };
      if (isNew(value)) {
        const edits = constructionEdits(value, '!');
        push('await', 'await on a call', node, edits && [{ ...drop, end: nextRealStart(value.sourceStart + 3) }, ...edits]);
      } else if (value && ['call', 'optcall', 'dynimport'].includes(value.semanticKind)) {
        const callee = child(value.nodeId, 'callee');
        const awaited = callee?.semanticKind === 'dammit' || callee?.semanticKind === 'maybe-dammit';
        const args = role(value.nodeId, 'args');
        push('await', 'await on a call', node, awaited ? null : [drop, { start: lastRealEndBefore(args.sourceStart), text: '!', rank: 2 },
          ...(value.semanticKind === 'call' ? emptyArgs(value) : [])]);
      }
    }
    if (rules.dammit && node.semanticKind === 'call' && child(node.nodeId, 'callee')?.semanticKind === 'dammit') {
      const args = role(node.nodeId, 'args');
      if (source.slice(args.sourceStart, args.sourceEnd) === '()') push('dammit', 'empty parens on a dammit call', node, [{ start: args.sourceStart, end: args.sourceEnd, text: '', rank: 0 }]);
    }
  }
  return found;
}

// A call whose whole argument list is one parenthesized group (`f (a)`): the
// group's own parens become the call's.
function soleParenGroup(tokens, args) {
  const i = tokens.findIndex((t) => t.start === args.sourceStart && t.kind === '(' && !t.generated);
  if (i === -1) return false;
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    const k = tokens[j].kind;
    if (k === '(') depth++;
    else if (k === ')') { depth--; if (depth === 0) return tokens[j].end === args.sourceEnd; }
  }
  return false;
}

// Whether the call's last argument is a multi-line heredoc (`"""` or `'''`)
// of its own. A plain heredoc is a single STRING token with no node; an
// interpolated one runs from STRING_START to its matching STRING_END.
function trailingHeredoc(tokens, source, args) {
  let j = tokens.length - 1;
  while (j >= 0 && !(!tokens[j].generated && tokens[j].end === args.sourceEnd)) j--;
  if (j < 0 || (tokens[j].kind !== 'STRING' && tokens[j].kind !== 'STRING_END')) return false;
  let start = tokens[j].kind === 'STRING' ? tokens[j].start : null;
  for (let k = j, depth = 0; start === null && k >= 0; k--) {
    if (tokens[k].kind === 'STRING_END') depth++;
    else if (tokens[k].kind === 'STRING_START' && --depth === 0) start = tokens[k].start;
  }
  if (start === null) return false;
  const quote = source.slice(start, start + 3);
  return (quote === '"""' || quote === "'''") &&
    source.slice(start, args.sourceEnd).includes('\n') &&
    /(^|,)\s*$/.test(source.slice(args.sourceStart, start));
}

// The real `(` … `)` pair that encloses the node with nothing but
// whitespace between, or null.
function enclosingGroup(tokens, source, node) {
  let i = -1;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.generated || typeof t.start !== 'number') continue;
    if (t.end > node.sourceStart) break;
    i = k;
  }
  if (i === -1 || tokens[i].kind !== '(' || source.slice(tokens[i].end, node.sourceStart).trim() !== '') return null;
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    const k = tokens[j].kind;
    if (k === '(') depth++;
    else if (k === ')' && --depth === 0) {
      if (tokens[j].start < node.sourceEnd || source.slice(node.sourceEnd, tokens[j].start).trim() !== '') return null;
      return { open: tokens[i], close: tokens[j] };
    }
  }
  return null;
}

// Whether the group is exactly the argument list of the implicit call that
// holds it (`f (a)`), whose fix turns the group into the call's own parens.
function isWholeArgs(group, node, parents, stores, tokenAt) {
  for (let id = parents.get(node.nodeId); id !== undefined; id = parents.get(id)) {
    if (!CALL_KINDS.has(stores.node(id).semanticKind)) continue;
    const args = stores.role(id, 'args');
    if (args && args.sourceStart === group.open.start && args.sourceEnd === group.close.end && tokenAt(args.sourceStart, 'CALL_START', true) !== null) return true;
  }
  return false;
}

// A call inside a render tree is template; a function the author wrote
// inside the tree (an event handler) is code again. The render rewrite wraps
// an element's child block in a function of its own, whose arrow is a
// zero-width generated token, so only a function with a spelled arrow
// counts.
function inRenderTree(node, parents, stores) {
  for (let id = parents.get(node.nodeId); id !== undefined; id = parents.get(id)) {
    const kind = stores.node(id).semanticKind;
    if (kind === 'func') {
      const arrow = stores.role(id, 'kind');
      if (arrow && arrow.sourceEnd > arrow.sourceStart) return false;
    }
    if (kind === 'render') return true;
  }
  return false;
}

// Edits are { start, end, text, rank }: replace [start, end) with text. They
// never overlap. At one offset, insertions apply ahead of a replacement that
// starts there, and in rank order among themselves: closers (negative rank,
// innermost first) ahead of openers (outermost first).
export function applyEdits(source, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start ||
    (a.end > a.start) - (b.end > b.start) || (a.rank ?? 0) - (b.rank ?? 0));
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) throw new Error(`lint: overlapping edits at offset ${e.start}`);
    out += source.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  return out + source.slice(cursor);
}

// nodeId → parent nodeId over the ANNOTATED nodes. Spread roles (`args`,
// `statements`, `items`) name no child, so the tree is recovered from
// containment: a sweep in span order with a stack of open ancestors. The
// parser constructs bottom-up, so where two nodes share a span the one
// with the higher id is the outer one.
export function parentsOf(stores) {
  const nodes = stores.nodes.filter((n) => n.semanticKind !== null)
    .sort((a, b) => a.sourceStart - b.sourceStart || b.sourceEnd - a.sourceEnd || b.nodeId - a.nodeId);
  const parents = new Map();
  const stack = [];
  for (const n of nodes) {
    while (stack.length && !(stack[stack.length - 1].sourceStart <= n.sourceStart && n.sourceEnd <= stack[stack.length - 1].sourceEnd)) stack.pop();
    if (stack.length) parents.set(n.nodeId, stack[stack.length - 1].nodeId);
    stack.push(n);
  }
  return parents;
}

function childrenOf(stores, parents) {
  const children = new Map();
  for (const [childId, parentId] of parents) {
    const child = stores.node(childId);
    const list = children.get(parentId);
    if (list) list.push(child); else children.set(parentId, [child]);
  }
  for (const list of children.values()) list.sort((a, b) => a.sourceStart - b.sourceStart);
  return children;
}
