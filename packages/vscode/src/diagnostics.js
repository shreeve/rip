// The diagnostic-mapping core: a tsgo diagnostic on the TS FACE →
// a diagnostic on the .rip source, plus the `rip.strict` /
// `@ts-expect-error` / `rip.noCheck` policy that decides which survive.
//
// This is the ONE honest copy of that logic. The editor server drives it
// per-keystroke over LSP pushes; `rip check` drives it in batch over a
// single `tsc --noEmit` pass. Both operate on the same `good` shape —
// { source, code, mappings, srcLineStarts, genLineStarts, strict } — so
// there is no second implementation to drift.

import path from 'node:path';
import {
  offsetToPosition, positionToOffset, generatedSpanToSource,
  SUPPRESSED_TS_CODES, diagnosticTagsFor,
} from './translate.js';
import { alwaysReported, isSyntaxClass } from './scopes.js';
import { declaredButUninstalled } from './mirror.js';

// A CompileError → { reason, start, end } in SOURCE offsets: the first
// message line with its `path:line:col:` prefix stripped (the excerpt
// below it repeats what the caller already shows), and the [start, end)
// span clamped to the text — a 1-char span when the error carries no
// position. The editor server wraps this into an LSP diagnostic; the
// batch `rip check` maps it to line/col. One formatter, so a change to
// CompileError's message format can't desync the two surfaces.
export function compileErrorInfo(err, textLength) {
  const start = typeof err.start === 'number' ? err.start : 0;
  const end = typeof err.end === 'number' && err.end > start ? err.end : Math.min(start + 1, textLength);
  let reason = String(err.message).split('\n')[0];
  if (err.path && reason.startsWith(`${err.path}:`)) {
    reason = reason.slice(err.path.length + 1).replace(/^\d+:\d+:\s*/, '');
  }
  return { reason, start, end: Math.min(end, textLength) };
}

// A tsgo diagnostic mapped onto .rip source, or null when it is a
// suppressed implicit-any code or its generated span has no honest
// source mapping (synthetic/injected regions). Under rip.strict the
// implicit-any family passes through — a strict project ASKED to be
// told where annotations are missing (presentation-only gate).
//
// `d` is LSP-shaped: { code, message, severity?, tags?, range:{start,end},
// relatedInformation? } with zero-based positions. The batch caller
// synthesizes the same shape from tsgo's pull diagnostics. This maps only
// the PRIMARY span; `relatedInformation` (secondary "declared here"-style
// locations) rides the pull when the client advertises the capability
// (`diagnostic: { relatedInformation: true }`), and the caller maps each
// related location itself rather than routing it through here.
export function mapTsDiagnostic(good, d) {
  if (!good.strict && SUPPRESSED_TS_CODES.has(d.code)) return null;
  // Installation pressure: a bare import the governing manifest declares
  // but nobody installed. Gradual holds it (the CLI counts it with the
  // install remedy); strict publishes. `good.dir` is the source file's
  // own dir — absent (older callers) leaves the defect published.
  if (!good.strict && d.code === 2307 && good.dir) {
    const spec = /Cannot find module '([^']+)'/.exec(d.message)?.[1];
    if (spec && declaredButUninstalled(spec, good.dir)) return null;
  }
  const s = positionToOffset(good.genLineStarts, good.code.length, d.range.start);
  const e = positionToOffset(good.genLineStarts, good.code.length, d.range.end);
  const span = generatedSpanToSource(good.mappings, s, e);
  // A generated span with no source mapping lives in a purely
  // synthetic region. A TYPE claim there is about bytes the author
  // never wrote — dropped. A SYNTAX-class error there still means the
  // face does not parse, so it reports at the FILE HEAD instead: a
  // vanished syntax error reads as a clean file.
  if (!span) {
    if (!isSyntaxClass(d.code)) return null;
    return {
      severity: d.severity ?? 1,
      code: d.code,
      source: 'rip/ts',
      message: d.message,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    };
  }
  // The DECLARATION-SCOPE gate. Judged on the MAPPED source position, so it
  // must follow the mapping: the question is which .rip declaration the
  // author would see this on, not where it landed in the face. A strict
  // project is ungated, and a name/module that does not resolve reports
  // either way — see scopes.js.
  if (!good.strict && good.checkedLines && !alwaysReported(d.code)) {
    const line = offsetToPosition(good.srcLineStarts, span[0]).line;
    if (!good.checkedLines[line]) return null;
  }
  // tsgo supplies Unnecessary/Deprecated tags itself over the pull slot;
  // diagnosticTagsFor is the fallback for any item tsgo leaves untagged
  // (a batch `tsc` run carries none), so VS Code renders the unused/
  // deprecated classes faded/struck, never underlined.
  const tags = d.tags ?? diagnosticTagsFor(d.code);
  // Suggestion-class rendering needs an EXACT span: a fade/strike paints
  // its whole range, and a COVER-mapped range would paint bytes the user
  // never wrote. Error-class diagnostics keep the cover fallback (a
  // visible error on the enclosing construct beats a dropped one); tagged
  // hints drop unless the offending bytes are the user's own.
  if (tags.length > 0) {
    const row = good.mappings.bestAtGenerated(s);
    if (!row || row.mappingKind !== 'exact') return null;
  }
  // A diagnostic born inside a face ECHO (a behavior object re-carrying
  // a body the real lowering already emitted) is a SECOND report of an
  // error the real copy publishes — and the echo's interior carries no
  // marks, so its report cover-maps onto the whole component/schema
  // head. Drop it unless it maps exactly (an anchored row — the
  // projection's own member-name anchor — is the echo's one first-class
  // diagnostic surface, and the reason the echo exists).
  if (good.echoSpans?.length > 0 &&
      good.echoSpans.some(([a, b]) => s >= a && s < b)) {
    const row = good.mappings.bestAtGenerated(s);
    if (!row || row.mappingKind !== 'exact') return null;
  }
  // A RECOVERED face (tolerant compile of an incomplete buffer) holds
  // bytes the user never typed: the synthetic closers and the zero-width
  // holes repair minted. TypeScript reads those as ordinary text and
  // reports on them — `items.` becomes `items.;`, and TS1003 "Identifier
  // expected" lands on the synthesized `;`. Such a span maps to no exact
  // row, so the cover fallback below paints the whole enclosing
  // construct: the import statement three lines up turns red for an
  // error about a byte rip invented. Rip already publishes its OWN
  // rejection at the true position, so the cover-mapped one is a
  // duplicate in the wrong place. Exactly-mapped errors still publish —
  // those are about the user's own bytes and survive the incompleteness.
  //
  // SCOPED to where minted bytes can exist: repair mints holes at the
  // incompleteness and closers after it, never before, so a cover span
  // that ends before the EARLIEST rejection is about settled text —
  // a real error on the user's own bytes, whose cover row is its only
  // mapping. File-wide suppression traded those for silence.
  if ((good.parseDiagnostics?.length ?? 0) > 0) {
    const from = Math.min(...good.parseDiagnostics.map((p) => p.start));
    if (span[1] >= from) {
      const row = good.mappings.bestAtGenerated(s);
      if (!row || row.mappingKind !== 'exact') return null;
    }
  }
  // Type-cycle diagnostics (TS2502/TS7022) born in a lowering name the
  // lowering's own vocabulary — a mutually-recursive computed pair
  // draws "'value' is referenced…" from the reactive container the
  // author never wrote. The projection anchors those rows at the
  // member's source name, so when the mapped span IS a single
  // identifier, the message requotes it: same claim, author's words.
  // A cycle in the user's own bytes requotes its own name — identity.
  let message = d.message;
  if (d.code === 2502 || d.code === 7022) {
    const spanText = good.source.slice(span[0], span[1]);
    if (/^[A-Za-z_$][\w$]*$/.test(spanText)) message = message.replace(/^'[^']*'/, `'${spanText}'`);
  }
  return {
    severity: d.severity ?? 1,
    code: d.code,
    source: 'rip/ts',
    message,
    ...(tags.length ? { tags } : {}),
    range: {
      start: offsetToPosition(good.srcLineStarts, span[0]),
      end: offsetToPosition(good.srcLineStarts, span[1]),
    },
  };
}

// A `# @ts-expect-error` directive governs the line DIRECTLY beneath
// it — tsc's one-line rule. An error inside a statement's indented
// block is NOT governed: a bug written later in a `def` body surfaces,
// and the directive above the head reports unused. A blank line
// beneath the directive leaves it governing nothing — the same
// next-line adjacency the emitter's attachment pre-pass requires, so
// broker and face agree on which line a marker reaches. The hatch for
// an error interior to a render element is a directive on the
// offending bind/prop line itself — the idiom TSX forces for a JSX
// attribute, and the emitter places it on the face line that pair's
// own diagnostics land on.
//
// The broker owns this over RIP positions because a FACE-level directive
// governs only its immediate next FACE line, which multi-line lowerings
// structurally defeat: an error whose mapped line is the governed head
// line suppresses (directive used), and a USED directive's
// spurious face-level TS2578 drops. A directive that rescues nothing
// keeps its TS2578 — unused stays loud, exactly tsc's contract.
export function ripDirectiveLines(good) {
  if (good._directiveLines === undefined) {
    const lines = [];
    good.source.split('\n').forEach((l, i) => {
      if (/^[ \t]*#[ \t]*@ts-(expect-error|ignore)(\s|$)/.test(l)) lines.push(i);
    });
    good._directiveLines = lines;
  }
  return good._directiveLines;
}

// Is `a` within `b`?
const inside = (a, b) =>
  (a.start.line > b.start.line || (a.start.line === b.start.line && a.start.character >= b.start.character)) &&
  (a.end.line < b.end.line || (a.end.line === b.end.line && a.end.character <= b.end.character));

// One claim can also land on spans that NEST rather than match: a component
// member's type is rendered twice (the class declare and the companion
// interface), and the two renderings mark different extents of the same
// annotation — `: T` against `T`. Same code, severity and message over a
// containing range is the same claim, so the narrowest span keeps it and
// exact ties go to the first.
//
// This runs LAST, after directives have been charged. A directive is
// charged by a diagnostic STARTING on its governed line, so collapsing
// first could retire the only row that starts there and leave the
// directive reading unused.
const collapseNested = (rows) => rows.filter((m, i) => !rows.some((o, j) => j !== i
  && o.code === m.code && o.severity === m.severity && o.message === m.message
  && inside(o.range, m.range)
  && (!inside(m.range, o.range) || j < i)));

export function applyRipDirectives(good, mapped) {
  // A lowering can manifest one source error at several face positions.
  // Once mapping collapses them to the same code, severity, range, and
  // message, one source claim owns one squiggle and one directive charge.
  const seen = new Set();
  mapped = mapped.filter((m) => {
    const key = `${m.code}\0${m.severity}\0${m.range.start.line}:${m.range.start.character}-${m.range.end.line}:${m.range.end.character}\0${m.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const directives = ripDirectiveLines(good);
  if (directives.length === 0) return collapseNested(mapped);
  const is2578 = (m) => String(m.code) === '2578';
  const used = new Set();
  const survivors = [];
  for (const m of mapped) {
    const line = m.range.start.line;
    if (!is2578(m)) {
      const r = directives.find((g) => line === g + 1);
      // A directive absorbs the ERRORS (and warnings) on its governed line,
      // and only those mark it USED. A suggestion-class hint there — an
      // unused-local fade (TS6133) on a throwaway test binding is the common
      // one — is not the error an `@ts-expect-error` promised, so it does
      // neither. Two independent rules, one condition:
      //
      //   · a hint must not mark it used — or tsgo's own "unused directive"
      //     TS2578 (which maps fine onto the directive comment) is dropped
      //     just below by `used.has(...)`, and the escape hatch rots silently
      //   · a hint must not be absorbed — tsc's directives govern errors,
      //     never the fade classes, so a suppressed line still dims its
      //     unused binding, exactly as the .ts twin does
      if (r !== undefined && (m.severity ?? 1) <= 2) { used.add(r); continue; }
    }
    survivors.push(m);
  }
  // tsgo's TS2578 ("unused '@ts-expect-error'") maps onto the directive
  // comment and arrives here as a normal diagnostic. Drop it only when the
  // directive is genuinely used — an ERROR landed on its governed line (a
  // mis-governed multi-line face directive whose leaked error we suppressed
  // over rip positions). Otherwise it survives: unused stays loud.
  return collapseNested(survivors.filter((m) => !(is2578(m) && used.has(m.range.start.line))));
}

// A rip.noCheck glob → anchored regex, matched against a project-root-
// relative posix path. `**/` spans zero-or-more directories (so
// `**/*.rip` matches a root file too), a trailing/standalone `**` spans
// anything, `*` stays within one segment, `?` is one non-slash char.
export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } // `**/` → zero+ dirs
        else { re += '.*'; i += 1; }                           // `**`  → anything
      } else { re += '[^/]*'; }                                // `*`   → one segment
    } else if (c === '?') { re += '[^/]'; }
    else if ('.+^${}()|[]\\'.includes(c)) { re += '\\' + c; }  // escape regex specials
    else { re += c; }
  }
  return new RegExp(`^${re}$`);
}

// Does this file match its project's rip.noCheck? Globs resolve relative
// to the config's directory (the project root, configDir), so `legacy/**`
// means legacy under THIS package, never a sibling's.
export function isNoCheckPath(fsPath, configDir, noCheck) {
  if (!noCheck?.length || !configDir) return false;
  let rel = path.relative(configDir, fsPath);
  if (rel.startsWith('..')) return false; // outside the project boundary
  rel = rel.split(path.sep).join('/');
  return noCheck.some((g) => globToRegex(g).test(rel));
}
