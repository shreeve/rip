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
export function buildProbe(faceCode, pinnables) {
  const jobs = pinnables
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => b.stmtGen[0] - a.stmtGen[0]);
  let text = faceCode;
  for (const p of jobs) {
    const at = lineStartOf(text, p.stmtGen[0]);
    const indent = /^[ \t]*/.exec(text.slice(at, text.indexOf('\n', at) + 1 || undefined))[0];
    const rhs = faceCode.slice(p.valueGen[0], p.valueGen[1]);
    text = `${text.slice(0, at)}${indent}let __rip_probe_${p.i}_${p.name} = ${rhs};\n${text.slice(at)}`;
  }
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const positions = pinnables.map((p, i) => {
    const offset = text.indexOf(`__rip_probe_${i}_${p.name}`);
    if (offset < 0) return null;
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
    return { line, character: offset - lineStarts[line] };
  });
  return { text, positions };
}

// tsgo hover markdown → type text, or null when the answer is unusable
// (no fence, evolving `any`, or a truncated printout). Multi-line type
// printouts collapse to single-line pin text.
export function parseProbeHover(hover) {
  const raw = hover?.contents?.value ?? '';
  const m = /```(?:typescript|ts)\n(?:let|var|const)\s+__rip_probe_\d+_[\w$]+!?\s*:\s*([\s\S]*?)\n?```/.exec(raw);
  if (!m) return null;
  const type = m[1].replace(/\s+/g, ' ').trim();
  if (!type || type === 'any' || type.includes('...')) return null;
  return type;
}
