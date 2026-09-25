// Semantic-token corrections over tsgo's answer, and the per-module
// record an importer's corrections read. Pure functions only — no
// protocol, no I/O — so the extension's unit suite drives the
// corrections against real compile output with neither a server nor
// tsgo.
//
// tsgo's relative-encoded data decodes against the FACE text; each token's generated span maps to Rip only where
// the correspondence is VERBATIM — an exact row (one sorted sweep;
// annotation tokens have real Rip spans in the face), or the
// edit-span mapper's verbatim-verified cover prefix (a rendered
// declaration's NAME — `interface Point` is one cover row whose bytes
// match the source through the name). Synthetic bytes and TS-only
// scaffolding have neither and drop. Hoisting emits one source name at
// several generated positions (the `let` line and the assignment), so
// mapped tokens DEDUP by source span — modifiers union, the
// declaration modifier from the hoist line survives on the merged
// token.
//
// Reactive STATE (`:=`) is the one form where TypeScript's modifiers lie. Its
// lowering binds a cell with `const`, so tsgo classifies the identifier
// `readonly` — true of the container, false of the name: `clicks = 5` is legal
// rip and lowers to `clicks.value = 5`. Forwarded as-is, the editor paints the
// only reactive form you may assign to as a constant. The compile reports the
// generated span of each state name (`mutables`), and the bit is cleared there
// and nowhere else — `=!`, `~=` and `~>` also emit `const` and really ARE
// immutable, so they keep it.
import { exactSpanMapper, generatedEditSpanToSource, positionToOffset } from './translate.js';

// tsgo's semantic-tokens legend, mirrored to the extension's own client: the token
// data arrays pass through re-encoded but never re-typed, so the legend
// must be tsgo's. The fallback matches the pinned tsgo's legend and
// only governs when tsgo failed to start (no tokens flow then anyway).
export const FALLBACK_LEGEND = {
  tokenTypes: [
    'namespace', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'type',
    'parameter', 'variable', 'property', 'enumMember', 'decorator', 'event',
    'function', 'method', 'macro', 'comment', 'string', 'keyword', 'number',
    'regexp', 'operator',
  ],
  tokenModifiers: [
    'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
    'async', 'modification', 'documentation', 'defaultLibrary',
  ],
};

// What a module's compile records for its IMPORTERS — the facts an
// importing file's compile cannot compute for itself: the names it
// declares as enums, the names a tag qualifies through (a module
// namespace from `export * as`, or an exported object of the module's
// own components — one list, because the one reader tokens both as
// `namespace`), and the names that are components.
export function importRecordOf(result) {
  return {
    enumNames: (result.bindings ?? []).filter((b) => b.kind === 'enum').map((b) => b.name),
    namespaceNames: [...(result.namespaceExports ?? []), ...(result.partNames ?? [])],
    componentNames: result.componentNames ?? [],
  };
}

// What such a record says `name` is: 'namespace', 'component', or null.
export function importedKindInRecord(record, name) {
  if ((record.namespaceNames ?? []).includes(name)) return 'namespace';
  if ((record.componentNames ?? []).includes(name)) return 'component';
  return null;
}

// tsgo's token data over the face, corrected and mapped onto the
// document's CURRENT text: the sorted list of { start, length, type,
// modifiers } in document offsets. `importedKindOf(specifier, name)`
// and `declaresEnum(specifier, name)` answer for the modules the file
// imports, relative to the file's own directory.
export function correctSemanticTokens(ctx, data, { legend, importedKindOf, declaresEnum }) {
  const mapSpan = exactSpanMapper(ctx.good.mappings);
  const roIndex = legend?.tokenModifiers?.indexOf('readonly') ?? -1;
  const roBit = roIndex < 0 ? 0 : (1 << roIndex);
  // Keyed by START offset: a state name's span IS the token, so the token's
  // generated start equals the span's exactly. A set lookup per token, rather
  // than a scan of every span for every token on a surface that fires on each
  // edit.
  const mutableStarts = new Set((ctx.good.mutables ?? []).map(([s]) => s));
  // Same keying, the other correction: an enum name's TYPE, not a
  // modifier bit. -1 when the client's legend omits `enum`, and then the
  // rewrite is skipped rather than pointed at some other type's index.
  const enumType = legend?.tokenTypes?.indexOf('enum') ?? -1;
  const enumStarts = new Set((ctx.good.enums ?? []).map(([s]) => s));
  // The third correction of the same shape: TypeScript classifies a binding
  // from its DECLARATION's initializer, so `let Shape = class {…}` colors
  // `class` on its own and reports nothing here — but a forward reference
  // splits the declaration from the class expression, and `let Box;` is a
  // variable as far as tsgo can see. -1 when the client's legend omits
  // `class`, and then the rewrite is skipped rather than pointed at some
  // other type's index, exactly as the enum correction does.
  const classType = legend?.tokenTypes?.indexOf('class') ?? -1;
  const classStarts = new Set((ctx.good.classDecls ?? []).map(([s]) => s));
  // The fourth correction of the same shape: a render loop's body lowers
  // to a block-function factory, so its item/index binding genuinely IS a
  // parameter in the face — the factory header, the keyed callback, every
  // read — and tsgo classifies each occurrence so. The author declared a
  // loop variable. The compiler reports each occurrence's span, so a
  // handler's own `(e) ->` parameter — a parameter in the source too — is
  // never touched: the correction is the span, not a rule over the block.
  const variableType = legend?.tokenTypes?.indexOf('variable') ?? -1;
  const loopStarts = new Set((ctx.good.loopVars ?? []).map(([s]) => s));
  // The one correction that DROPS instead of retyping: a render attribute
  // name's token is suppressed, so a plain prop (whose `property` maps
  // exactly and would forward) reads like its two-way-bound neighbor
  // (whose minted key cannot map and already drops) — every attribute
  // falls back to the TextMate attribute scope, the one fact all of them
  // share. Never the reverse: no token is invented at the bind's span,
  // and the drop is keyed by the compiler's span, so a property inside an
  // attribute's VALUE keeps its own.
  const attrStarts = new Set((ctx.good.attrNames ?? []).map(([s]) => s));
  // An IMPORTED enum carries the same merged-symbol `type` classification
  // its declaration does, and the importing file's compile cannot know
  // that — the kind lives in the declaring module. The compiler reports
  // which references are imports and from where; the module answers.
  // Only `./`-relative `.rip` specifiers resolve, matching the closure's
  // own rule (mirror.js): a package import is TypeScript's to classify.
  // tsgo emits no token on an import line, nor for a binding that resolves
  // to a module (the classifier has no word for a source file). TypeScript's
  // own convention stands: a name on an import line is `variable`, one
  // color whatever it names, and a READ takes its kind — for a module
  // namespace (`export * as`), an exported object of components, or a
  // component, what the declaring module's record says. The one
  // correction that ADDS tokens, and only at spans the compiler recorded
  // as the binding's.
  const namespaceType = legend?.tokenTypes?.indexOf('namespace') ?? -1;
  // A tag qualifies through an exported object of components as through
  // a module namespace, and the declaring module records both under one
  // name — but tsgo DOES token the object, as the readonly variable its
  // declaration made. So a namespace answer is two corrections: the
  // silent add below, and a retype of any token at the span, keyed by
  // start as the others are, which also drops the readonly bit — the
  // qualifier is what the tag constructs through, not a binding whose
  // mutability is at issue.
  const namespaceStarts = new Set();
  const silentRefs = []; // [genStart, genEnd, type] — tokens to add where tsgo emitted none
  for (const [genStart, genEnd, importedName, specifier, site] of (ctx.good.importedRefs ?? [])) {
    if (site === 'declaration') {
      if (variableType >= 0) silentRefs.push([genStart, genEnd, variableType]);
      continue;
    }
    const kind = importedName === '*' ? 'namespace' : importedKindOf(specifier, importedName);
    if (kind === 'namespace' && namespaceType >= 0) {
      namespaceStarts.add(genStart);
      silentRefs.push([genStart, genEnd, namespaceType]);
      continue;
    }
    if (kind === 'component' && classType >= 0) { silentRefs.push([genStart, genEnd, classType]); continue; }
    if (declaresEnum(specifier, importedName)) enumStarts.add(genStart);
  }
  const tokens = new Map(); // start → { start, length, type, modifiers }
  let line = 0, char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    line += data[i];
    char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
    const length = data[i + 2];
    const genStart = positionToOffset(ctx.good.genLineStarts, ctx.good.code.length, { line, character: char });
    if (attrStarts.has(genStart)) continue;
    const srcStart = mapSpan(genStart, genStart + length)
      ?? generatedEditSpanToSource(ctx.good.mappings, genStart, genStart + length, ctx.good.source, ctx.good.code)?.[0]
      ?? null;
    if (srcStart === null) continue;
    const curStart = ctx.align.toCurrent(srcStart);
    const curEnd = ctx.align.toCurrent(srcStart + length, { exclusiveEnd: true });
    if (curStart === null || curEnd !== curStart + length) continue;
    // Cleared BEFORE the dedup union below, or a second generated manifestation
    // of the same name would put the bit straight back.
    let modifiers = data[i + 4];
    if (roBit && mutableStarts.has(genStart)) modifiers &= ~roBit;
    // An enum name carries the merged symbol's `readonly` too, off the
    // `const` object half. The construct is a declaration, not a
    // binding whose mutability is at issue, so the corrected token
    // drops it with the type — TypeScript's own enum tokens carry
    // neither.
    let type = data[i + 3];
    if (enumType >= 0 && enumStarts.has(genStart)) {
      type = enumType;
      modifiers &= ~roBit;
    }
    if (classType >= 0 && classStarts.has(genStart)) type = classType;
    if (variableType >= 0 && loopStarts.has(genStart)) type = variableType;
    if (namespaceType >= 0 && namespaceStarts.has(genStart)) {
      type = namespaceType;
      modifiers &= ~roBit;
    }
    const key = curStart * 0x100000 + length;
    const existing = tokens.get(key);
    if (existing && existing.type === type) {
      existing.modifiers |= modifiers;
    } else if (!existing) {
      tokens.set(key, { start: curStart, length, type, modifiers });
    }
  }
  // A fresh mapper: the one above has walked past the import lines, and
  // it answers in ascending order only. A recorded name has an exact row,
  // so nothing falls back.
  const mapSilent = exactSpanMapper(ctx.good.mappings);
  for (const [genStart, genEnd, type] of silentRefs.sort((a, b) => a[0] - b[0])) {
    const length = genEnd - genStart;
    const srcStart = mapSilent(genStart, genEnd);
    if (srcStart === null) continue;
    const curStart = ctx.align.toCurrent(srcStart);
    const curEnd = ctx.align.toCurrent(srcStart + length, { exclusiveEnd: true });
    if (curStart === null || curEnd !== curStart + length) continue;
    const key = curStart * 0x100000 + length;
    if (!tokens.has(key)) tokens.set(key, { start: curStart, length, type, modifiers: 0 });
  }
  return [...tokens.values()].sort((a, b) => a.start - b.start);
}
