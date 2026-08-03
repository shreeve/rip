// Tier 3 pin probe — the editor half of the evolving-let tiers.
//
// Declare-in-place (Tier 1) gives every straight-line binding native
// TS inference. What remains hoisted-and-unannotated with nested
// references is exactly the shape TypeScript refuses to infer
// (TS7034: evolving-let serves only same-function references) — no
// site in the real face knows the type, driven and verified. So the
// server manufactures a site that does: a PROBE file (a copy of the
// face with `let __rip_probe_<i>_<name> = <first-write RHS>;` spliced
// immediately above each first write, same scope, so every RHS name
// resolves identically), hovers the probe declarations, and feeds the
// answers back into compile() as pins. The probe file never executes,
// is never pulled for diagnostics (the server's pull model only
// requests open rip mirrors), exports nothing new, and is deleted
// after the probe round.
//
// WHY MORE TIER 1 CANNOT RETIRE THIS. The two sets are disjoint by
// construction: captureScan records a declare-in-place site only for a
// TOP-LEVEL `=`, while a binding is pinnable only if it STAYED hoisted and
// is read from inside a closure. Widening declare-in-place therefore reaches
// none of the remainder — it shrinks this pass's input without touching its
// reason, and cannot shrink it to nothing. Retiring the probe round takes a
// DIFFERENT mechanism: inferring the first-write type statically onto the
// hoist line, in-face, so no manufactured site is needed at all.
//
// WHY A PROBE AND NOT AN IN-FACE DECLARATION. The obvious simplification —
// emit `const __p = <first-write RHS>; let x: typeof __p;` into the face and
// delete this file — was built and measured (2026-07-31) and REFUSED. Three
// findings, so it does not get re-proposed from the same reasoning:
//
//   · it does not reach zero. 29 of 230 declarations fail to resolve at the
//     best legal placement, because the RHS reads a name the scope declares
//     later or a block-local. The probe has no such limit: it types from a
//     manufactured site, not from a position in the real scope.
//   · the diagnostics it adds are mostly WRONG. Over four packages it
//     reported 21 the probe does not, and 19 were false — `Cannot find name
//     'ctx'` on the author's own lines, naming variables that are in scope
//     where they were written. It lost 7 real ones.
//   · the case it genuinely wins — a forward-referenced class, which the
//     probe declines and silently misses (the probe refuses class/
//     component-valued first writes so it never pins its own manufactured
//     symbol: TS2304 on legal code; gated in `check` and `pins`) — has a
//     population of ZERO here: no class- or component-valued first write
//     exists in the corpus or in packages/.
//
// That last number is the whole trade, and it is the one most likely to
// change: rip's component story is what would make forward-referenced
// components ordinary. If they become common, revisit — but only as the
// consumer splice, placed AFTER the hoist line, with the class expression
// named from the author's binding, generated-region suppression, and a
// nullish/empty-first-write exclusion. Nothing less was measured to work.
//
// Every failure path lands on the status quo: an unparseable hover, a
// truncated type (`...`), or a bare `any` caches as null (no pin, no
// retry until the defining expression changes — the pin key hashes the
// first-write VALUE source text).

const lineStartOf = (text, offset) => text.lastIndexOf('\n', offset - 1) + 1;

// Face + pinnables → { text, positions } where positions[i] is the
// zero-based line/character of pinnable i's probe declaration name.
// Splices run bottom-up so earlier offsets stay valid; probe names are
// index-qualified so same-named bindings in different scopes never
// collide.
// The minted prefix, read from ONE spelling by everything that depends on
// it: the splice below, the position lookup, the answer regex, and the
// unusable-answer filter's self-reference clause. That clause has to reject
// exactly what this mints — two literals that must agree is the drift this
// module cannot afford, because disagreement fails SILENTLY (a filter that
// stops matching just starts accepting dangling pins again).
export const PROBE_PREFIX = '__rip_probe_';

export function buildProbe(faceCode, pinnables) {
  const jobs = pinnables
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => b.stmtGen[0] - a.stmtGen[0]);
  let text = faceCode;
  for (const p of jobs) {
    const at = lineStartOf(text, p.stmtGen[0]);
    const indent = /^[ \t]*/.exec(text.slice(at, text.indexOf('\n', at) + 1 || undefined))[0];
    const rhs = faceCode.slice(p.valueGen[0], p.valueGen[1]);
    // A pattern binding's value is one step INSIDE the assign's value, so it
    // probes through its accessor path (`.json`, `[0]`) rather than at the
    // whole RHS — otherwise every sibling of one pattern would be pinned the
    // type of the entire object. Parenthesised because the RHS is an
    // arbitrary expression and an object literal at statement start would
    // otherwise read as a block. Empty path — a plain target, whose value IS
    // the RHS — splices exactly as before.
    const init = p.path ? `(${rhs})${p.path}` : rhs;
    text = `${text.slice(0, at)}${indent}let ${PROBE_PREFIX}${p.i}_${p.name} = ${init};\n${text.slice(at)}`;
  }
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const positions = pinnables.map((p, i) => {
    const offset = text.indexOf(`${PROBE_PREFIX}${i}_${p.name}`);
    if (offset < 0) return null;
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
    return { line, character: offset - lineStarts[line] };
  });
  return { text, positions };
}

// The answer shape, built ONCE from the prefix and escaped on the way in.
// Escaped because the prefix is a value, not a pattern: a rename to anything
// carrying `.` or `$` would otherwise change what this MATCHES rather than
// fail, and `.` in particular would accept a declaration buildProbe never
// minted — the silent drift the constant exists to prevent, reintroduced at
// the one site that interpolates it into a regex. No `g` flag, so the shared
// instance carries no lastIndex between calls.
const ANSWER = new RegExp(
  '```(?:typescript|ts)\\n(?:let|var|const)\\s+'
  + PROBE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  + '\\d+_[\\w$]+!?\\s*:\\s*([\\s\\S]*?)\\n?```',
);

// tsgo hover markdown → type text, or null when the answer is unusable
// (no fence, evolving `any`, a truncated printout, or an answer naming a
// probe symbol). Multi-line type printouts collapse to single-line pin text.
export function parseProbeHover(hover) {
  const raw = hover?.contents?.value ?? '';
  const m = ANSWER.exec(raw);
  if (!m) return null;
  const type = m[1].replace(/\s+/g, ' ').trim();
  if (!type || type === 'any' || type.includes('...')) return null;
  // A probe symbol in the TYPE cannot outlive the probe file. tsgo types an
  // anonymous class by its own binding, so a class-expression RHS answers
  // `typeof <probe symbol>`; accepted, that annotates the real binding with a
  // name deleted along with the probe, and tsgo publishes TS2304 on legal
  // code in vocabulary the author can find nowhere. Rejecting lands on the
  // probe round's status quo — an unpinned evolving `any` — which is the
  // doctrine every other clause here follows. The test reads the TYPE, never
  // the declaration's own minted name, which every answer carries.
  if (type.includes(PROBE_PREFIX)) return null;
  return type;
}
