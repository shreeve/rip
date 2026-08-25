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
async function typeOfExport(ck, symbol) {
  let sym = symbol;
  if (sym.flags & SymbolFlags.Alias) {
    try { sym = await ck.getAliasedSymbol(sym); } catch { /* keep the alias */ }
  }
  const typeOnly = Boolean((sym.flags & TYPE_ONLY) && !(sym.flags & VALUE_LIKE));
  const type = await (typeOnly ? ck.getDeclaredTypeOfSymbol(sym) : ck.getTypeOfSymbol(sym));
  return { type, typeOnly };
}

// Whose member is this? A package cannot fix `Promise<Response>`, and a class
// that extends Error carries Error's whole surface — reporting either names
// the language, not the API. Read off the declaration, which is the only
// place the answer lives.
//
// A declaration's path is the checker's CANONICAL form: on a
// case-insensitive filesystem it is case-folded, and need not match the
// spelling this process holds. The comparison is case-insensitive for that
// reason. A package that appears to own nothing descends into nothing, and
// comes back fully typed.
const canonical = (p) => String(p ?? '').toLowerCase();
const declaredAt = (decl, dir) => {
  const under = canonical(dir);
  const p = canonical(decl?.path);
  return p === under || p.startsWith(under + path.sep);
};
const declaredUnder = (sym, dir) => {
  const under = canonical(dir);
  return (sym.declarations ?? []).some((d) => {
    const p = canonical(d?.path);
    return p === under || p.startsWith(under + path.sep);
  });
};

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
async function widthOf(ck, type, pkgDir) {
  if ((type.flags & TypeFlags.Any) !== 0) return 'any';
  if ((type.flags & TypeFlags.Unknown) !== 0) return 'unknown';
  if ((type.flags & TypeFlags.NonPrimitive) !== 0) return 'object';
  const symbol = await type.getSymbol();
  // The global `Function`: callable with any arguments, returning `any`.
  if (symbol?.name === 'Function' && !declaredUnder(symbol, pkgDir)) return 'Function';
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
async function walkOne(ck, rootType, rootName, pkgDir, maxDepth, reads, rootSymbol, siblings) {
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
      const width = await widthOf(ck, item.type, pkgDir);
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
          next.push({
            type: await ck.getReturnTypeOfSignature(sig),
            at: isCtor ? `${item.at}#` : `${item.at}()`,
            bare: isCtor,
            reads: item.reads,
            stated: true,
            origin: item.origin,
          });
        }
      }
      for (const prop of await ck.getPropertiesOfType(item.type)) {
        if (!declaredUnder(prop, pkgDir)) continue;
        // A member that IS another published export stops the walk. It has
        // its own row, its own verdict, and one edit fixes it there;
        // repeating its defects under everything that happens to expose it
        // reports one piece of work as several.
        const propType = await ck.getTypeOfSymbol(prop);
        const propSymbol = await propType.getSymbol();
        if (propSymbol != null && propSymbol.id !== rootSymbol?.id && siblings.has(propSymbol.id)) continue;
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
        if (info.declaration !== undefined && !declaredAt(info.declaration, pkgDir)) continue;
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
          if (symbol != null && !declaredUnder(symbol, pkgDir)) continue;
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
export async function walkPublicEntry(session, { mirrorFile, pkgMirrorDir, maxDepth = 10, only = null }) {
  const snapshot = await session.updateSnapshot({ openFiles: [mirrorFile] });
  const project = await snapshot.getDefaultProjectForFile(mirrorFile);
  if (!project) return { rows: [], unexplored: 0, forwarded: 0, unresolved: 'no project covers the mirrored entry' };
  const ck = project.checker;
  const source = await project.program.getSourceFile(mirrorFile);
  const moduleSymbol = source === undefined ? undefined : await ck.getSymbolAtLocation(source);
  if (!moduleSymbol) return { rows: [], unexplored: 0, forwarded: 0, unresolved: 'the mirrored entry resolves to no module' };

  const rows = [];
  let unexplored = 0, forwarded = 0;
  const exported = await moduleSymbol.getExports();
  // What else this entry publishes, so the walk can stop at it.
  const siblings = new Set();
  for (const [, sym] of exported) {
    let s = sym;
    if (s.flags & SymbolFlags.Alias) { try { s = await ck.getAliasedSymbol(s); } catch { /* keep it */ } }
    siblings.add(s.id);
  }
  for (const [name, symbol] of exported) {
    if (only !== null && !only.has(name)) continue;
    // `export * from './x'` arrives as one marker symbol rather than as the
    // names it forwards, which are published all the same. The marker
    // counts as a gap, never as zero names: an entry that only re-exports
    // is an ordinary shape, and reading it as an empty surface makes it a
    // perfectly typed one. It is counted apart from the walk's own limits
    // because the two do not share a remedy.
    if (symbol.flags & SymbolFlags.ExportStar) { forwarded++; continue; }
    const { type, typeOnly } = await typeOfExport(ck, symbol);
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
    let rootSym = symbol;
    if (rootSym.flags & SymbolFlags.Alias) { try { rootSym = await ck.getAliasedSymbol(rootSym); } catch { /* keep it */ } }
    const found = await walkOne(ck, type, name, pkgMirrorDir, maxDepth, typeOnly ? null : true, rootSym, siblings);
    unexplored += found.unexplored;
    rows.push({ name, type: printed, kind: found.kind, why: found.why, at: found.at, origin: found.origin, defects: found.defects });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, unexplored, forwarded, unresolved: null };
}
