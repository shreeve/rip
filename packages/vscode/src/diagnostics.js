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
  const s = positionToOffset(good.genLineStarts, good.code.length, d.range.start);
  const e = positionToOffset(good.genLineStarts, good.code.length, d.range.end);
  const span = generatedSpanToSource(good.mappings, s, e);
  if (!span) return null;
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
  return {
    severity: d.severity ?? 1,
    code: d.code,
    source: 'rip/ts',
    message: d.message,
    ...(tags.length ? { tags } : {}),
    range: {
      start: offsetToPosition(good.srcLineStarts, span[0]),
      end: offsetToPosition(good.srcLineStarts, span[1]),
    },
  };
}

// A `# @ts-expect-error` directive governs the next non-blank SOURCE
// LINE only — tsc's next-line rule. Errors on deeper indented body
// lines stay loud; put the marker on the offending line (including a
// render bind/prop line — the face emits that form). Blank lines
// between the directive and its target are skipped when locating the
// head; they do not extend the range past it.
//
// The broker owns this over RIP positions because a FACE-level directive
// governs only its immediate next FACE line, which multi-line lowerings
// structurally defeat: an error whose mapped line sits under
// a source directive suppresses (directive used), and a USED directive's
// spurious face-level TS2578 drops. A directive that rescues nothing
// keeps its TS2578 — unused stays loud, exactly tsc's contract.
export function ripDirectiveLines(good) {
  if (good._directiveRanges === undefined) {
    const src = good.source.split('\n');
    const ranges = [];
    src.forEach((l, i) => {
      if (!/^[ \t]*#[ \t]*@ts-(expect-error|ignore)(\s|$)/.test(l)) return;
      let start = i + 1;
      while (start < src.length && src[start].trim() === '') start++;
      if (start >= src.length) return;
      ranges.push({ line: i, start, end: start });
    });
    good._directiveRanges = ranges;
  }
  return good._directiveRanges;
}

export function applyRipDirectives(good, mapped) {
  const ranges = ripDirectiveLines(good);
  if (ranges.length === 0) return mapped;
  const is2578 = (m) => String(m.code) === '2578';
  const used = new Set();
  const survivors = [];
  for (const m of mapped) {
    const line = m.range.start.line;
    if (!is2578(m)) {
      const r = ranges.find((g) => line >= g.start && line <= g.end);
      // A directive absorbs the ERRORS (and warnings) in its range, and only
      // those mark it USED. A suggestion-class hint in the range — an
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
      if (r && (m.severity ?? 1) <= 2) { used.add(r.line); continue; }
    }
    survivors.push(m);
  }
  // tsgo's TS2578 ("unused '@ts-expect-error'") maps onto the directive
  // comment and arrives here as a normal diagnostic. Drop it only when the
  // directive is genuinely used — an ERROR fell in its range (a mis-governed
  // multi-line face directive whose leaked error we suppressed over rip
  // positions). Otherwise it survives: unused stays loud.
  return survivors.filter((m) => !(is2578(m) && used.has(m.range.start.line)));
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
