// The PUBLIC-surface walk: what a consumer's checker resolves for every name
// a package publishes, and where the first `any` sits inside it.
//
// Every question here is asked of the type checker as a question about
// types, and no answer is a printed type re-read as meaning. That
// distinction is load-bearing rather than stylistic: a printed name is not
// an identity, since two files may each declare a `Config`; a declaration
// is not one either, since `typeof C` and `C` share one; and no rendering
// of a type recovers what the checker already knows. `TypeFlags.Any` is
// exact, `type.id` is identity, `getSignaturesOfType` opens what no
// expression can reach, and a symbol's declarations say whose it is.
//
// The direction of any error here is the reason for that care. A walk that
// stops early reports the export it was walking as fully typed, so every
// way of losing the thread reads as a clean surface.
import { API, TypeFlags, SymbolFlags, SignatureKind, NodeBuilderFlags, ObjectFlags } from 'typescript/unstable/async';
import path from 'node:path';
import { SyntaxKind } from 'typescript/unstable/ast';

// Types with a call or construct signature are opened through it; the rest
// are opened through their properties. Both, for anything that has both.
const SIGNATURES = [[true, SignatureKind.Construct], [false, SignatureKind.Call]];

// A name that is only ever a type has no value to take the type OF — its
// meaning is the type it declares.
const TYPE_ONLY = SymbolFlags.Interface | SymbolFlags.TypeAlias;
const VALUE_LIKE = SymbolFlags.Variable | SymbolFlags.Function | SymbolFlags.Class
  | SymbolFlags.Enum | SymbolFlags.ValueModule | SymbolFlags.Method | SymbolFlags.Property;

export function createPublicSession(mirrorRoot) {
  return new API({ cwd: mirrorRoot });
}

// The type a published name resolves to, following `export { X }` to what X
// actually is.
async function typeOfExport(ck, sym) {
  const typeOnly = isTypeOnly(sym);
  const type = await (typeOnly ? ck.getDeclaredTypeOfSymbol(sym) : ck.getTypeOfSymbol(sym));
  return { type, typeOnly };
}

// Whose member is this? A package cannot fix `Promise<Response>`, and a class
// that extends Error carries Error's whole surface — reporting either names
// the language, not the API. Read off the declaration, which is the only
// place the answer lives.
//
// The question is answered by the CALLER, through `owns`, because the answer
// is "the package whose package.json is nearest this declaration" and only
// the caller knows how a mirrored path maps back to a source file. A rule
// spelled here as directory arithmetic gets the answer wrong for an entry
// beside its package, an entry below it, a package nested inside it, and a
// mirror rooted outside the workspace — each of which is a different special
// case for a prefix and none of which is special for a manifest.
//
// The direction of a wrong answer is the whole reason for the care: a
// package that appears to own nothing descends into nothing, and comes back
// fully typed.
const declaredAt = (decl, owns) => owns(decl?.path);
const declaredUnder = (sym, owns) => (sym.declarations ?? []).some((d) => owns(d?.path));

// What `export { X }` actually names. Spelled once: the sibling stop
// compares identity against the RESOLVED symbol, and a second copy that
// stopped following the alias would leave the two describing different
// symbols and the stop would quietly never fire.
async function resolveAlias(ck, symbol) {
  if (!(symbol.flags & SymbolFlags.Alias)) return symbol;
  try { return await ck.getAliasedSymbol(symbol); } catch { return symbol; }
}

// A name that is only ever a type has no value to take the type OF, so its
// row is walked undirected and never evaluates read-side width.
const isTypeOnly = (sym) => Boolean((sym.flags & TYPE_ONLY) && !(sym.flags & VALUE_LIKE));

// Every symbol a module publishes, with the POLARITY its own row is walked
// from. Collected across all of a package's entries before any walk: a
// package publishes from every entry its manifest names, so what it
// publishes is a property of the package, not of whichever entry is in hand.
export async function exportIdsOf(session, mirrorFile) {
  const ids = new Map();
  const snapshot = await session.updateSnapshot({ openFiles: [mirrorFile] });
  const project = await snapshot.getDefaultProjectForFile(mirrorFile);
  if (!project) return ids;
  const ck = project.checker;
  const source = await project.program.getSourceFile(mirrorFile);
  if (source === undefined) return ids;
  const moduleSymbol = await ck.getSymbolAtLocation(source);
  if (!moduleSymbol) return ids;
  const { entries } = await exportsOfModule(ck, moduleSymbol);
  for (const [, sym] of entries) {
    const s = await resolveAlias(ck, sym);
    ids.set(s.id, isTypeOnly(s) ? null : true);
  }
  return ids;
}

// What a module publishes, with every `export *` FOLLOWED to its target.
//
// A module's own export table lists a re-export as one opaque marker, not as
// the names it forwards, so reading it alone reports a barrel — the ordinary
// shape of a package index — as a surface with nothing on it. Each star is
// therefore resolved through its own declaration: the clause's module
// specifier names a module, and that module's exports are the names this one
// publishes.
//
// A floor means the star could not be FOLLOWED — no module specifier, an
// unresolvable module. It does not mean the star contributed no NAMES: a
// star whose names are all shadowed by direct exports was followed
// perfectly and hid nothing, and counting that as a floor fails a clean
// package. Per declaration, so two unfollowable stars count two, which no
// arithmetic on the merged marker symbol could recover.
//
// Direct exports win over forwarded ones, as they do at run time.
async function exportsOfModule(ck, moduleSymbol) {
  const entries = new Map();                 // symbol name -> symbol
  const seen = new Set();                    // module ids, so a cycle ends
  const queue = [moduleSymbol];
  let unfollowed = 0;
  // Breadth-first, because stars COMPOSE: a barrel's target is free to be
  // another barrel, and stopping at the first hop loses everything behind
  // it while reporting an empty, perfect surface. Breadth-first also gives
  // shadowing for free — a name reached in fewer hops wins, and the entry's
  // own direct exports are reached in none.
  while (queue.length > 0) {
    const mod = queue.shift();
    if (seen.has(mod.id)) continue;
    seen.add(mod.id);
    const table = await mod.getExports().catch(() => null);
    if (table == null) { unfollowed++; continue; }
    for (const [, sym] of table) {
      if (sym.flags & SymbolFlags.ExportStar) {
        for (const decl of sym.declarations ?? []) {
          const node = await decl.resolve().catch(() => null);
          const spec = node?.moduleSpecifier;
          const target = spec == null ? null : await ck.getSymbolAtLocation(spec).catch(() => null);
          if (target == null) { unfollowed++; continue; }   // a star we cannot follow
          queue.push(target);
        }
        continue;
      }
      // Never the table KEY: that is TypeScript's escaped form, where a
      // leading `__` becomes `___` and matches no name a consumer imports.
      if (!entries.has(sym.name)) entries.set(sym.name, sym);
    }
  }
  return { entries: [...entries], unfollowed };
}

// Where an importer USES a name, and where that name ARRIVED, as
// generated-text spans.
//
// The two are kept apart because they answer different questions. A use is
// where the value is consumed — a place a reader's own type safety ends.
// The arrival is the import specifier, which is not a use at all: it is the
// one position in the file that names what came in untyped, and so the
// place to open the file at.
//
// A binding is resolved BY NAME in the importing file, because a reference
// search is answered for the local alias and not for the export it aliases:
// asking with the exporting module's symbol finds nothing at all.
export async function useSitesOf(session, { mirrorFile, names }) {
  const snapshot = await session.updateSnapshot({ openFiles: [mirrorFile] });
  const project = await snapshot.getDefaultProjectForFile(mirrorFile);
  if (!project) return new Map();
  const ck = project.checker;
  const source = await project.program.getSourceFile(mirrorFile);
  if (source === undefined) return new Map();
  const meaning = SymbolFlags.Value | SymbolFlags.Alias | SymbolFlags.Type;
  const out = new Map();
  for (const name of names) {
    const symbol = await ck.resolveName(name, meaning, source, false).catch(() => null);
    if (!symbol) continue;
    const refs = await ck.getReferencesToSymbolInFile(mirrorFile, symbol).catch(() => null);
    const uses = [];
    let arrival = null;
    for (const handle of refs ?? []) {
      const node = await handle.resolve().catch(() => null);
      if (node === null) continue;
      const span = [await node.getStart(), await node.getEnd()];
      const kind = node.parent?.kind;
      if (kind === SyntaxKind.ImportSpecifier || kind === SyntaxKind.ImportClause
        || kind === SyntaxKind.NamespaceImport) {
        if (arrival === null) arrival = span;
        continue;
      }
      uses.push(span);
    }
    if (uses.length > 0) out.set(name, { uses, arrival });
  }
  return out;
}

// A type that carries no information AT the position it sits in.
//
// `any` and `Function` are the same defect wearing different clothes: both
// accept anything and hand back an unchecked value, so a consumer's misuse
// of either goes unreported. The rest — `unknown`, `object`, `{}` — carry
// nothing either, but they say so: reading one is a compile error rather
// than a silent hole. Which of those matters depends on which way the value
// is travelling, so the caller decides what to do with the answer.
//
// `never` is absent on purpose. It is the honest return of a function that
// throws, and three of this repo's exports are exactly that.
async function widthOf(ck, type, owns) {
  if ((type.flags & TypeFlags.Any) !== 0) return 'any';
  if ((type.flags & TypeFlags.Unknown) !== 0) return 'unknown';
  if ((type.flags & TypeFlags.NonPrimitive) !== 0) return 'object';
  const symbol = await type.getSymbol();
  // The global `Function`: callable with any arguments, returning `any`.
  if (symbol?.name === 'Function' && !declaredUnder(symbol, owns)) return 'Function';
  // `{}` has no flag of its own — it is an object type with nothing in it.
  if ((type.flags & TypeFlags.Object) === 0) return null;
  // A MAPPED type has no members until its parameter is bound, and reading
  // that emptiness as `{}` calls every generic alias information-free —
  // `AppData<S>` describes its shape entirely in terms of `S`.
  if ((type.objectFlags & ObjectFlags.Mapped) !== 0) return null;
  if ((await ck.getPropertiesOfType(type)).length > 0) return null;
  if ((await ck.getIndexInfosOfType(type)).length > 0) return null;
  for (const [, kind] of SIGNATURES) {
    if ((await ck.getSignaturesOfType(type, kind)).length > 0) return null;
  }
  return '{}';
}

// Whether a position STATES a contract. An annotation is a claim about what
// belongs here, however wide; a type that merely fell out of a default value
// claims nothing, and `opts = {}` is a missing annotation rather than a
// decision to accept any object.
async function isStated(symbol) {
  const declaration = symbol?.declarations?.[0];
  if (declaration === undefined) return true;
  const node = await declaration.resolve().catch(() => null);
  return node === null || node.type != null;
}

// WHERE a position was declared, as a generated-text offset.
//
// The path a finding prints says where the defect surfaces in the type; it
// does not say what to edit. A value assembled through inner definitions
// surfaces its `any` at the export — `http(input)` — while the parameter
// that carries it belongs to a lambda several definitions away, and
// annotating the obvious candidate changes nothing. The declaring symbol
// knows the difference.
async function declarationSiteOf(symbol) {
  const declaration = symbol?.declarations?.[0];
  if (declaration === undefined) return null;
  const node = await declaration.resolve().catch(() => null);
  if (node === null) return null;
  let start = null;
  try { start = await node.getStart(); } catch { return null; }
  return typeof start === 'number' ? { path: String(declaration.path), start } : null;
}

// One published name, walked breadth-first to its first defect.
//
// Breadth-first so the shallowest leak is the one reported: the path a
// consumer meets first is the one worth printing. The depth limit bounds
// COST, and what it cuts is unexamined rather than clean — that count
// leaves with the verdict, never discarded.
async function walkOne(ck, rootType, rootName, owns, maxDepth, reads, rootSymbol, siblings) {
  const seen = new Set();
  const found = [];
  // Polarity: which way the value travels at this position. The export is
  // something a consumer READS, and a parameter reverses that — including a
  // parameter OF a parameter, which is an argument the consumer's own
  // callback receives and so is read again. Width costs opposite things on
  // the two sides, and the same shape is a defect on one and a decision on
  // the other.
  let level = [{ type: rootType, at: rootName, bare: false, reads, stated: true, origin: rootSymbol }];
  for (let depth = 0; depth < maxDepth && level.length; depth++) {
    const next = [];
    for (const item of level) {
      const width = await widthOf(ck, item.type, owns);
      // `any` and `Function` are unchecked in either direction. Anything
      // else that carries nothing is a defect only where the consumer
      // READS, or where it arrived without an annotation to claim it.
      if (width !== null && (width === 'any' || width === 'Function' || item.reads === true || !item.stated)) {
        found.push({ why: width, at: item.at, origin: await declarationSiteOf(item.origin) });
        continue;
      }
      if (seen.has(item.type.id)) continue;          // this very type, already walked
      seen.add(item.type.id);
      for (const [isCtor, kind] of SIGNATURES) {
        for (const sig of await ck.getSignaturesOfType(item.type, kind)) {
          for (const p of await sig.getParameters()) {
            next.push({
              type: await ck.getTypeOfSymbol(p),
              at: isCtor ? `${item.at}.new(${p.name})` : `${item.at}(${p.name})`,
              bare: false,
              // No direction stays no direction: `!null` is `true`, which
              // would invent a read the export never claimed.
              reads: item.reads === null ? null : !item.reads,
              stated: await isStated(p),
              origin: p,
            });
          }
          // A constructor's return is the INSTANCE — the half of a class no
          // property enumeration reaches, since enumerating a class yields
          // its statics.
          // The instance a constructor yields carries the constructor's
          // parameters with it, so a field synthesized from `@name = param`
          // can be recognised where the two TYPES are in hand. Sharing a
          // name is not evidence of the assignment; sharing a name and a
          // type is what `@name = param` actually produces.
          const ctorParams = [];
          if (isCtor) {
            for (const p of await sig.getParameters()) {
              ctorParams.push({ name: p.name, id: (await ck.getTypeOfSymbol(p)).id });
            }
          }
          next.push({
            type: await ck.getReturnTypeOfSignature(sig),
            at: isCtor ? `${item.at}#` : `${item.at}()`,
            bare: isCtor,
            reads: item.reads,
            stated: true,
            origin: item.origin,
            ctorParams,
          });
        }
      }
      for (const prop of await ck.getPropertiesOfType(item.type)) {
        if (!declaredUnder(prop, owns)) continue;
        // A member that IS another published export stops the walk. It has
        // its own row, its own verdict, and one edit fixes it there;
        // repeating its defects under everything that happens to expose it
        // reports one piece of work as several.
        //
        // Only where that row answers the question THIS position asks. A
        // sibling is walked from one side — a value is read, a bare type has
        // no direction at all — and a stop at a row that never evaluates
        // this side hands the position to a row that will not report it.
        const propType = await ck.getTypeOfSymbol(prop);
        const propSymbol = await propType.getSymbol();
        const sibling = propSymbol == null ? undefined : siblings.get(propSymbol.id);
        if (propSymbol != null && propSymbol.id !== rootSymbol?.id
          && sibling !== undefined && sibling === item.reads) continue;
        // A field that is the shadow of a constructor parameter is not its
        // own work: annotating the parameter answers both, and reporting it
        // twice overstates the edits. Decided on name AND type, never on
        // name alone — a field that merely borrows a parameter's name was
        // never fed by it, and hiding it sends the reader in a circle:
        // annotate what the report names, and the field appears next run.
        const shadows = (item.ctorParams ?? []).some((cp) => cp.name === prop.name && cp.id === propType.id);
        if (shadows) continue;
        next.push({
          type: propType,
          at: `${item.at}${item.bare ? '' : '.'}${prop.name}`,
          bare: false,
          reads: item.reads,
          stated: await isStated(prop),
          origin: prop,
        });
      }
      // What a type CONTAINS as well as what it exposes. `any[]`,
      // `Promise<any>` and `Record<string, any>` each hand a consumer an
      // `any` while being, themselves, none of the things checked above:
      // the type is an array or a promise or an object with an index
      // signature, its own flags are not Any, and every member it exposes
      // belongs to the language rather than to this package. Reached
      // through the three shapes that hold a type inside another one.
      //
      // The ownership line runs here too, and it falls between what a
      // package WROTE and what it merely NAMED. A type argument is written
      // at the reference — the `any` in `any[]` is the package's, and its
      // to fix. The body of a foreign alias is not: `body?: BodyInit` is a
      // fully typed thing to write, and the `any` inside the DOM's own
      // definition of `BodyInit` belongs to the DOM.
      if (await item.type.isTypeReference()) {
        const args = await ck.getTypeArguments(item.type);
        const array = await ck.isArrayType(item.type);
        args.forEach((arg, i) => next.push({
          type: arg,
          at: array ? `${item.at}[]` : `${item.at}<${i}>`,
          bare: false,
          reads: item.reads,
          stated: item.stated,
          origin: item.origin,
        }));
      }
      for (const info of await ck.getIndexInfosOfType(item.type)) {
        // Only GENERAL indexing — a `string` or `number` key. An index
        // keyed by a pattern describes a family of names rather than the
        // surface at large, and the compiler keys its own slot namespace
        // that way (`[key: \`_${string}\`]: any`), which no consumer
        // writes and none of them can reach.
        if ((info.keyType.flags & (TypeFlags.String | TypeFlags.Number)) === 0) continue;
        if (info.declaration !== undefined && !declaredAt(info.declaration, owns)) continue;
        next.push({ type: info.valueType, at: `${item.at}[]`, bare: false, reads: item.reads, stated: item.stated, origin: item.origin });
      }
      if (await item.type.isUnionType() || await item.type.isIntersectionType()) {
        // Ownership is asked of each MEMBER, not of the union. A union does
        // not reliably remember the name it came from: adding `null` and
        // `undefined` to a foreign alias — which is what an optional
        // property does under strictNullChecks — forms a new union that has
        // no alias at all. Reading that absence as "written here" opens the
        // foreign definition and reports its insides as this package's
        // defect. A member carries its own declaration and cannot lose it.
        const members = await item.type.getTypes();
        for (const [i, member] of members.entries()) {
          const symbol = await member.getSymbol();
          if (symbol != null && !declaredUnder(symbol, owns)) continue;
          next.push({ type: member, at: `${item.at}|${i}`, bare: false, reads: item.reads, stated: item.stated, origin: item.origin });
        }
      }
    }
    level = next;
  }
  // One DECLARATION reached by several paths is one thing to fix: the six
  // verbs share a lambda, and naming it six times would read as six defects.
  const bySite = new Map();
  for (const f of found) {
    const key = f.origin === null ? `path:${f.at}` : `${f.origin.path}|${f.origin.start}`;
    if (!bySite.has(key)) bySite.set(key, f);
  }
  const defects = [...bySite.values()];
  return defects.length === 0
    ? { kind: 'typed', why: null, at: null, origin: null, defects: [], unexplored: level.length }
    : { kind: 'leak', why: defects[0].why, at: defects[0].at, origin: defects[0].origin, defects, unexplored: level.length };
}

// Every name one entry publishes, with the type a consumer resolves for it.
// `only` narrows the roots to a named subset — what one importer actually
// took, rather than everything the module publishes. A count of the whole
// surface says the same thing to every consumer of a package and so says
// nothing about any of them.
export async function walkPublicEntry(session, { mirrorFile, owns, maxDepth = 10, only = null, siblingIds = null }) {
  const snapshot = await session.updateSnapshot({ openFiles: [mirrorFile] });
  const project = await snapshot.getDefaultProjectForFile(mirrorFile);
  if (!project) return { rows: [], unexplored: 0, forwarded: 0, unresolved: 'no project covers the mirrored entry' };
  const ck = project.checker;
  const source = await project.program.getSourceFile(mirrorFile);
  const moduleSymbol = source === undefined ? undefined : await ck.getSymbolAtLocation(source);
  if (!moduleSymbol) return { rows: [], unexplored: 0, forwarded: 0, unresolved: 'the mirrored entry resolves to no module' };

  const rows = [];
  let unexplored = 0, forwarded = 0;
  const { entries: exported, unfollowed } = await exportsOfModule(ck, moduleSymbol);
  forwarded = unfollowed;
  // What else this entry publishes, so the walk can stop at it.
  const siblings = siblingIds ?? new Map();
  for (const [, sym] of exported) {
    const s = await resolveAlias(ck, sym);
    if (!siblings.has(s.id)) siblings.set(s.id, isTypeOnly(s) ? null : true);
  }
  for (const [name, symbol] of exported) {
    if (only !== null && !only.has(name)) continue;
    // `export * from './x'` arrives as one marker symbol rather than as the
    // names it forwards, which are published all the same. The marker
    // counts as a gap, never as zero names: an entry that only re-exports
    // is an ordinary shape, and reading it as an empty surface makes it a
    // perfectly typed one. It is counted apart from the walk's own limits
    // because the two do not share a remedy.
    if (symbol.flags & SymbolFlags.ExportStar) continue;   // counted once, when followed
    const rootSym = await resolveAlias(ck, symbol);
    const { type, typeOnly } = await typeOfExport(ck, rootSym);
    // A type prints as it was WRITTEN, which is not always what it means: an
    // annotation naming something unresolvable resolves to `any` while still
    // printing the name that was reached for. Showing the written form alone
    // puts a rich-looking type beside a verdict of `any` and reads as a tool
    // error; showing both says what happened, and points at the annotation
    // that did not land.
    // Printed WHOLE. The type printer elides a long member list by default
    // (`... 5 more ...`), and this column is the published surface itself —
    // the one thing a reader checks the verdict against.
    const written = await ck.typeToString(type, undefined, NodeBuilderFlags.NoTruncation);
    const printed = ((type.flags & TypeFlags.Any) !== 0 && written !== 'any')
      ? `any (written: ${written})`
      : written;
    // A VALUE is something a consumer reads. A bare TYPE is not: it may be
    // an options bag they construct or a result they inspect, and nothing
    // about the export says which. Its positions get only the rules that
    // hold either way.
    const found = await walkOne(ck, type, name, owns, maxDepth, typeOnly ? null : true, rootSym, siblings);
    unexplored += found.unexplored;
    // Q3: three states, and the third is a fact about this AUDIT rather than
    // about the code. A name declared in another package is published here
    // all the same, but ownership rejects every position beneath it, so the
    // walk descended into nothing and learned nothing. "Found no defect" and
    // "was never able to look" are not the same answer, and only one of them
    // is a clean bill.
    const kind = found.kind === 'typed' && !declaredUnder(rootSym, owns) ? 'unaudited' : found.kind;
    rows.push({ name, type: printed, kind, defects: found.defects });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, unexplored, forwarded, unresolved: null };
}
