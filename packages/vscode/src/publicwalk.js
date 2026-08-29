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

// The session preamble every entry point here shares: one snapshot, the
// project that covers the mirror file, its checker, and the source file —
// with `ck` null or `source` undefined when the thread is lost, for the
// caller to answer in its own terms (an empty result, a named reason).
// The snapshot rides back because its lifetime is the CALLER's: it is
// disposed when the caller is done asking, never sooner.
async function moduleAt(session, mirrorFile) {
  const snapshot = await session.updateSnapshot({ openFiles: [mirrorFile] });
  const project = await snapshot.getDefaultProjectForFile(mirrorFile);
  const ck = project ? project.checker : null;
  const source = ck === null ? undefined : await project.program.getSourceFile(mirrorFile);
  return { snapshot, ck, source };
}

// The type a published name resolves to, following `export { X }` to what X
// actually is. The checker is allowed to have NO answer — `getTypeOfSymbol`
// returns undefined and `getDeclaredTypeOfSymbol` throws when the server
// sends no type — and either way the caller gets undefined, never a crash:
// one odd symbol must not take the whole audit down with it.
async function typeOfExport(ck, sym) {
  const typeOnly = isTypeOnly(sym);
  return await (typeOnly ? ck.getDeclaredTypeOfSymbol(sym) : ck.getTypeOfSymbol(sym)).catch(() => undefined);
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

// The width of a type, asked once per type however many paths arrive at it:
// it is a fact about the TYPE, fixed for the whole entry. (A Map holds null
// verdicts apart from absent ones.)
async function widthCached(ck, type, owns, functionTypeId, caches) {
  let width = caches.width.get(type.id);
  if (width === undefined) {
    width = await widthOf(ck, type, owns, functionTypeId, caches.members);
    caches.width.set(type.id, width);
  }
  return width;
}

// Does this position's type name another export the package publishes?
//
// A member that IS another published export stops the walk. It has its own
// row, its own verdict, and one edit fixes it there; repeating its defects
// under everything that happens to expose it reports one piece of work as
// several.
//
// Membership is the whole question. Every row applies one verdict — `any`
// and `Function` wherever they sit, anything else only where nothing claimed
// the position — so a sibling's row reports what this position would,
// whatever either was reached from, and the stop hands the work to a row
// that will do it.
//
// A name is a name however the type was spelled, and the checker holds two
// of them apart: `symbol` is where a type was declared, `aliasSymbol` the
// alias that named it. A class declaration produces one symbol serving both
// the constructor and the instance type, so asking for the symbol alone
// answers for a class — but an alias to an object literal answers with the
// anonymous object's symbol and carries its own name only as the alias, so
// one question sees every such alias as nothing the package published.
//
// Asked wherever a position is OPENED — a member, a signature's parameter,
// a signature's return. Which of the three a position is says nothing about
// whose edit its defects are, and the edit is what a row reports.
//
// The export currently being walked is never a stop for itself: its row is
// the one already open, and deferring to it hands the position to nobody.
// That is silent under-reporting, which is the one direction of error this
// walk exists to avoid.
//
// So is a stop where the sibling's row has no answer to give, and only a
// type that CARRIES something is safe to defer. A row applies one verdict,
// and two of its three grounds — `any` and `Function` — are facts about the
// type, which a sibling's row reaches identically however it was arrived
// at. The third is not: a type carrying nothing is a defect exactly where
// nothing claimed the position, and what claimed a position is a fact about
// the POSITION. `type Empty = {}` states itself, so its own row is clean,
// while an unannotated binding resolving to it is a defect that row will
// never raise.
async function namesSibling(ck, type, siblings, rootSymbol, owns, functionTypeId, caches) {
  const named = [await type.getSymbol(), await type.getAliasSymbol()];
  if (rootSymbol != null && named.some((sym) => sym != null && sym.id === rootSymbol.id)) return false;
  if (!named.some((sym) => sym != null && siblings.has(sym.id))) return false;
  return await widthCached(ck, type, owns, functionTypeId, caches) === null;
}

// A name that is only ever a type has no value to take the type OF, so its
// type is the one it DECLARES — a distinction the checker draws with two
// different calls, and answering it with the wrong one resolves nothing.
const isTypeOnly = (sym) => Boolean((sym.flags & TYPE_ONLY) && !(sym.flags & VALUE_LIKE));

// Every symbol a module publishes. Collected across all of a package's
// entries before any walk: a package publishes from every entry its
// manifest names, so what it publishes is a property of the package, not
// of whichever entry is in hand.
export async function exportIdsOf(session, mirrorFile) {
  const ids = new Set();
  const { snapshot, ck, source } = await moduleAt(session, mirrorFile);
  try {
    if (ck === null || source === undefined) return ids;
    const moduleSymbol = await ck.getSymbolAtLocation(source);
    if (!moduleSymbol) return ids;
    const { entries } = await exportsOfModule(ck, moduleSymbol);
    for (const [, sym] of entries) {
      const s = await resolveAlias(ck, sym);
      ids.add(s.id);
    }
    return ids;
  } finally {
    // Released HERE, not at session close: every snapshot the session ever
    // took stays live on the server until one or the other, and a run
    // takes one per entry, per consumer, and per sibling prebuild.
    await snapshot.dispose?.();
  }
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
  const { snapshot, ck, source } = await moduleAt(session, mirrorFile);
  try {
    if (ck === null || source === undefined) return new Map();
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
        // An `export { name }` clause forwards the value onward; nothing
        // at that position consumes it — the same non-use the import
        // specifier is, one node over.
        if (kind === SyntaxKind.ExportSpecifier) continue;
        uses.push(span);
      }
      if (uses.length > 0) out.set(name, { uses, arrival });
    }
    return out;
  } finally {
    await snapshot.dispose?.();
  }
}

// A type that carries no information AT the position it sits in.
//
// `any` and `Function` are the same defect wearing different clothes: both
// accept anything and hand back an unchecked value, so a consumer's misuse
// of either goes unreported. The rest — `unknown`, `object`, `{}` — carry
// nothing either, but they say so: reading one is a compile error rather
// than a silent hole. Which of those matters depends on which way the value
// is traveling, so the caller decides what to do with the answer.
//
// `never` is absent on purpose. It is the honest return of a function that
// throws, and three of this repo's exports are exactly that.

// The member collections of a type — signatures of both kinds, properties,
// index infos — fetched ONCE per type per entry and cached: widthOf's
// emptiness probe and the walk's descent read the same lists, every fetch
// is a round-trip against the async checker, and a type reached through
// several paths must pay once, not per arrival.
async function membersOf(ck, type, cache) {
  const hit = cache.get(type.id);
  if (hit !== undefined) return hit;
  const signatures = [];
  for (const [isCtor, kind] of SIGNATURES) signatures.push([isCtor, await ck.getSignaturesOfType(type, kind)]);
  const made = {
    signatures,
    props: await ck.getPropertiesOfType(type),
    indexInfos: await ck.getIndexInfosOfType(type),
  };
  cache.set(type.id, made);
  return made;
}

async function widthOf(ck, type, owns, functionTypeId, members) {
  if ((type.flags & TypeFlags.Any) !== 0) return 'any';
  if ((type.flags & TypeFlags.Unknown) !== 0) return 'unknown';
  if ((type.flags & TypeFlags.NonPrimitive) !== 0) return 'object';
  const symbol = await type.getSymbol();
  // The global `Function`: callable with any arguments, returning `any`.
  // Known by IDENTITY where the caller resolved it — this file's own rule
  // that a printed name is not one — so a foreign type that merely shares
  // the name is never mistaken for it. The name is only the fallback for a
  // program where the global could not be resolved at all.
  const isGlobalFunction = functionTypeId !== null ? type.id === functionTypeId : symbol?.name === 'Function';
  if (symbol != null && isGlobalFunction && !declaredUnder(symbol, owns)) return 'Function';
  // `{}` has no flag of its own — it is an object type with nothing in it.
  if ((type.flags & TypeFlags.Object) === 0) return null;
  // A MAPPED type has no members until its parameter is bound, and reading
  // that emptiness as `{}` calls every generic alias information-free —
  // `AppData<S>` describes its shape entirely in terms of `S`.
  if ((type.objectFlags & ObjectFlags.Mapped) !== 0) return null;
  const { signatures, props, indexInfos } = await membersOf(ck, type, members);
  if (props.length > 0) return null;
  if (indexInfos.length > 0) return null;
  for (const [, sigs] of signatures) {
    if (sigs.length > 0) return null;
  }
  return '{}';
}

// Whether a type annotation is the AUTHOR's claim.
//
// Not every annotation in the face was written by one. A pin is the type
// the compiler inferred for a still-hoisted binding and spelled into the
// face itself, and it is an ordinary annotation there — syntax cannot tell
// it from one the author wrote, so the caller supplies the offsets. Every
// position inside a pin's type text arrived with nothing claiming it,
// however annotated it looks: `let make: () => { hole: unknown }` is the
// compiler describing what it found, not a contract anyone offered.
async function authored(typeNode, declPath, synthesized) {
  if (typeNode == null) return false;
  let start = null;
  try { start = await typeNode.getStart(); } catch { return true; }
  return typeof start !== 'number' || !synthesized(declPath, start);
}

// Whether a position STATES a contract. An annotation is a claim about what
// belongs here, however wide; a type that merely fell out of a default value
// claims nothing, and `opts = {}` is a missing annotation rather than a
// decision to accept any object.
async function isStated(symbol, synthesized) {
  const declaration = symbol?.declarations?.[0];
  if (declaration === undefined) return true;
  const node = await declaration.resolve().catch(() => null);
  return node === null || await authored(node.type, declaration.path, synthesized);
}

// Whether an EXPORT states its own type, which is a different question from
// the one above. A declaration that spells the shape out — a class, an
// interface, a function — IS the claim, and has no annotation to look for;
// only a BINDING takes its type from one, and a binding without it takes
// whatever its initializer happened to produce. `export env = Proxy.new {}`
// resolves to `{}` because nothing said otherwise, and that is the position
// this answers for.
async function isStatedExport(symbol, synthesized) {
  const declaration = symbol?.declarations?.[0];
  if (declaration === undefined) return true;
  const node = await declaration.resolve().catch(() => null);
  if (node === null) return true;
  if (node.type != null) return authored(node.type, declaration.path, synthesized);
  return node.initializer === undefined;
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

// WHERE a SIGNATURE is written, as a generated-text offset.
//
// A return is the one position under a signature that no symbol of its own
// claims: a parameter carries its declaration, and the return carries
// nothing. Attributed instead to whatever EXPOSES the signature, one lambda
// published under several names reports its single return as several things
// to fix, and the count says more work is left than there is.
//
// A parameter is the way in. A parameter's declaration sits inside the
// function that declares it, and that function is the one place a return
// annotation can go — so every name exposing that lambda arrives at the
// same site. A signature with no parameters offers no way in and answers
// null, for the caller to fall back on what exposed it.
async function signatureSiteOf(params) {
  for (const p of params) {
    const declaration = p?.declarations?.[0];
    if (declaration === undefined) continue;
    const node = await declaration.resolve().catch(() => null);
    const fn = node?.parent;
    if (fn == null) continue;
    let start = null;
    try { start = await fn.getStart(); } catch { continue; }
    if (typeof start === 'number') return { path: String(declaration.path), start };
  }
  return null;
}

// Whether a SIGNATURE states its return, reached the same two ways and for
// the same reason: the return carries no symbol of its own, so the
// annotation is read off the FUNCTION.
//
// A parameter is the way in, and its parent is that function whatever the
// function is spelled like. With no parameter to enter by, the symbol that
// exposes the signature answers instead — and a binding holds its function
// in an initializer, so `f = (): unknown -> …` writes the annotation there
// rather than on `f`. The binding's own annotation still wins where it has
// one, which is what `f: Reader = -> …` claims.
async function returnIsStated(params, origin, synthesized) {
  for (const p of params) {
    const declaration = p?.declarations?.[0];
    if (declaration === undefined) continue;
    const node = await declaration.resolve().catch(() => null);
    const fn = node?.parent;
    if (fn != null) return authored(fn.type, declaration.path, synthesized);
  }
  const declaration = origin?.declarations?.[0];
  if (declaration === undefined) return true;
  const node = await declaration.resolve().catch(() => null);
  if (node === null) return true;
  return await authored(node.type, declaration.path, synthesized)
    || await authored(node.initializer?.type, declaration.path, synthesized);
}

// One published name, walked breadth-first to its first defect.
//
// Breadth-first so the shallowest leak is the one reported: the path a
// consumer meets first is the one worth printing.
//
// Nothing bounds the number of levels. The `seen` pair below ends every
// cycle, which is what a self-containing type is — but a generic that
// instantiates itself with a growing argument (`Chain<T>` answering
// `Chain<T[]>`) mints a type per level, and a pair that never repeats is
// no cycle to end. That surface has no bottom and this loop does not
// return. Two CLI paths arrive here and a hang wears either name: the
// `--public` audit, and the inherited-`any` advisory an ordinary `rip
// check` runs over the published surface of a strict package's
// dependencies.
async function walkOne(ck, rootType, rootName, owns, rootSymbol, siblings, functionTypeId, caches, synthesized, claims) {
  const seen = new Set();
  const found = [];
  // Positions the CHECKER had no type for. The async API is allowed to
  // answer a symbol with undefined, and a thread lost there is unexamined
  // surface, not clean surface — it leaves as the walk's floor.
  let lost = 0;
  let level = [{ type: rootType, at: rootName, bare: false, stated: await isStatedExport(rootSymbol, synthesized), origin: rootSymbol }];
  while (level.length) {
    const next = [];
    for (const item of level) {
      const width = await widthCached(ck, item.type, owns, functionTypeId, caches);
      // A signature position that states nothing publishes whatever the
      // body or the default produced, however specific that looks. An
      // inferred type is a snapshot of an implementation rather than a
      // contract offered to anyone: it moves when the implementation
      // moves, and a consumer who compiled against it is told nothing.
      // The two positions where inference answers with something specific
      // enough to hide behind are a return and a parameter carrying a
      // default — a parameter with neither is `any`, and caught below.
      const unclaimed = claims && item.signature === true && !item.stated;
      // `any` and `Function` are unchecked in either direction. Anything
      // else that carries nothing is a defect only where it arrived
      // without an annotation to claim it.
      //
      // The audit flags positions where a consumer can be WRONG without
      // being told, and a written `unknown` is the opposite of that: the
      // compiler stops the consumer until they narrow, whichever way the
      // value travels. Some values genuinely have no knowable shape — a
      // caller's payload, a caught throw — and naming that is the whole
      // answer rather than a placeholder for a better one. Whether a
      // narrower type exists is a judgment about intent that no walk can
      // make; it belongs in review, and the lazy case costs a consumer
      // ceremony rather than correctness.
      if (width !== null && (width === 'any' || width === 'Function' || !item.stated)) {
        found.push({ why: width, at: item.at, origin: item.site ?? await declarationSiteOf(item.origin) });
        continue;
      }
      // A position that states nothing still HAS a type, and everything
      // under it is surface a consumer meets. Recorded and then walked
      // into: a missing annotation names itself without hiding what a
      // stated one would have been checked against.
      if (unclaimed) {
        found.push({ why: 'inferred', at: item.at, origin: item.site ?? await declarationSiteOf(item.origin) });
      }
      // This very type, already opened from this very declaration. The
      // pair is the unit because the pair is what a finding names: one
      // declaration reached by several paths is one edit, and remembering
      // the type alone would be right if that were the whole story — but
      // one type sitting at several declarations is an edit each, and a
      // memory keyed on the type drops every arrival after the first.
      // What it drops is a position the walk never examined, which leaves
      // as clean surface.
      //
      // The declaration is the one a finding HERE would name, which is the
      // signature's own where the position has it and the arriving symbol
      // otherwise. Reading it any other way splits the two apart, and a
      // position the report would have placed somewhere new is dropped as
      // already covered.
      //
      // The pair ends every CYCLE. A type that contains itself re-arrives
      // through the same declaration that holds it, and stops there. It
      // ends nothing else: a type made on demand is a pair that has never
      // been seen, and there is no cycle in an arrival that never returns.
      const arrival = item.site
        ? `${item.type.id}|${item.site.path}:${item.site.start}`
        : `${item.type.id}|${item.origin?.id ?? 0}`;
      if (seen.has(arrival)) continue;
      seen.add(arrival);
      const { signatures, props, indexInfos } = await membersOf(ck, item.type, caches.members);
      for (const [isCtor, sigs] of signatures) {
        for (const sig of sigs) {
          // One pass over the parameters serves both readers below: the
          // walk item and, for a constructor, the shadow ledger — each
          // type fetch is a round-trip against the async checker.
          //
          // The ledger exists because a constructor's return is the
          // INSTANCE — the half of a class no property enumeration
          // reaches, since enumerating a class yields its statics — and
          // the instance carries the constructor's parameters with it, so
          // a field synthesized from `@name = param` can be recognized
          // where the two TYPES are in hand. Sharing a name is not
          // evidence of the assignment; sharing a name and a type is what
          // `@name = param` actually produces.
          const ctorParams = [];
          const params = await sig.getParameters();
          for (const p of params) {
            const pType = await ck.getTypeOfSymbol(p);
            if (pType === undefined) { lost++; continue; }
            // Recorded before the stop: the ledger is what the constructor
            // TAKES, and a parameter whose defects belong to another row is
            // still a parameter a field was fed from.
            if (isCtor) ctorParams.push({ name: p.name, id: pType.id });
            if (await namesSibling(ck, pType, siblings, rootSymbol, owns, functionTypeId, caches)) continue;
            next.push({
              type: pType,
              at: isCtor ? `${item.at}.new(${p.name})` : `${item.at}(${p.name})`,
              bare: false,
              signature: true,
              stated: await isStated(p, synthesized),
              origin: p,
            });
          }
          const returnType = await ck.getReturnTypeOfSignature(sig);
          if (returnType === undefined) { lost++; continue; }
          if (await namesSibling(ck, returnType, siblings, rootSymbol, owns, functionTypeId, caches)) continue;
          next.push({
            type: returnType,
            at: isCtor ? `${item.at}#` : `${item.at}()`,
            bare: isCtor,
            // A constructor is not exempt. It has no return annotation to
            // omit — a class body IS the claim — but an EMPTY body claims
            // nothing, and `{}` is the one width a class instance can
            // carry. TypeScript classes are structural, so `class Empty`
            // accepts every non-nullish value and is a hole a consumer
            // falls through rather than an opaque token. Answering here
            // the way every other return does reports exactly that case
            // and no other.
            // A constructor states its return by being one: the class body
            // is the claim, and there is no annotation to leave off. Only
            // the width test below answers for the instance.
            signature: !isCtor,
            stated: await returnIsStated(params, item.origin, synthesized),
            origin: item.origin,
            site: await signatureSiteOf(params),
            ctorParams,
          });
        }
      }
      for (const prop of props) {
        if (!declaredUnder(prop, owns)) continue;
        const propType = await ck.getTypeOfSymbol(prop);
        if (propType === undefined) { lost++; continue; }
        if (await namesSibling(ck, propType, siblings, rootSymbol, owns, functionTypeId, caches)) continue;
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
          stated: await isStated(prop, synthesized),
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
      //
      // A type written AT the reference is fixed where the reference is,
      // so both branches below carry the position's site down with them:
      // the `any` in a return's `Promise<any>` is the return annotation's
      // to fix, wherever that return was reached from. An index signature
      // is not written at the reference — it is a member with a
      // declaration of its own, which is the declaration that owns it and
      // the one an edit goes to — so the site stops there.
      if (await item.type.isTypeReference()) {
        const args = await ck.getTypeArguments(item.type);
        const array = await ck.isArrayType(item.type);
        args.forEach((arg, i) => next.push({
          type: arg,
          at: array ? `${item.at}[]` : `${item.at}<${i}>`,
          bare: false,
          stated: item.stated,
          origin: item.origin,
          site: item.site,
        }));
      }
      for (const info of indexInfos) {
        // Only GENERAL indexing — a `string` or `number` key. An index
        // keyed by a pattern describes a family of names rather than the
        // surface at large, and the compiler keys its own slot namespace
        // that way (`[key: \`_${string}\`]: any`), which no consumer
        // writes and none of them can reach.
        if ((info.keyType.flags & (TypeFlags.String | TypeFlags.Number)) === 0) continue;
        if (info.declaration !== undefined && !declaredAt(info.declaration, owns)) continue;
        next.push({ type: info.valueType, at: `${item.at}[]`, bare: false, stated: item.stated, origin: item.origin });
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
          next.push({ type: member, at: `${item.at}|${i}`, bare: false, stated: item.stated, origin: item.origin, site: item.site });
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
    ? { kind: 'typed', why: null, at: null, origin: null, defects: [], lost }
    : { kind: 'leak', why: defects[0].why, at: defects[0].at, origin: defects[0].origin, defects, lost };
}

// Every name one entry publishes, with the type a consumer resolves for it.
// `only` narrows the roots to a named subset — what one importer actually
// took, rather than everything the module publishes. A count of the whole
// surface says the same thing to every consumer of a package and so says
// nothing about any of them.
// `claims` asks the CONTRACT question — a published position that states
// no type is a defect, whatever inference put there. A caller asking only
// what ARRIVES in a consumer's hands turns it off: an unstated position
// still hands over a real type, and stopping the walk there would hide an
// `any` further down that the consumer does meet.
export async function walkPublicEntry(session, { mirrorFile, owns, only = null, siblingIds = null, synthesized = () => false, claims = true }) {
  const { snapshot, ck, source } = await moduleAt(session, mirrorFile);
  try {
    if (ck === null) return { rows: [], lost: 0, forwarded: 0, unresolved: 'no project covers the mirrored entry' };
    const moduleSymbol = source === undefined ? undefined : await ck.getSymbolAtLocation(source);
    if (!moduleSymbol) return { rows: [], lost: 0, forwarded: 0, unresolved: 'the mirrored entry resolves to no module' };

    // The global `Function` type, resolved ONCE and held as an identity for
    // the width check: two files may each declare a `Function`, and only the
    // global one is the anything-goes callable the check is about.
    const functionSymbol = await ck.resolveName('Function', SymbolFlags.Type, source, false).catch(() => null);
    const functionType = functionSymbol == null ? null : await ck.getDeclaredTypeOfSymbol(functionSymbol).catch(() => null);
    const functionTypeId = functionType?.id ?? null;
    // Per-ENTRY: types recur across an entry's exports, and both caches are
    // facts about a type under this entry's snapshot.
    const caches = { members: new Map(), width: new Map() };

    const rows = [];
    let lost = 0, forwarded = 0;
    const { entries: exported, unfollowed } = await exportsOfModule(ck, moduleSymbol);
    forwarded = unfollowed;
    // What else this entry publishes, so the walk can stop at it. Under
    // `only`, the stop may defer only to a row that will EXIST — a sibling
    // the narrowing filters out below has no row, and seeding it here hands
    // its defects to a row that never prints.
    const siblings = siblingIds ?? new Set();
    for (const [name, sym] of exported) {
      if (only !== null && !only.has(name)) continue;
      const s = await resolveAlias(ck, sym);
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
      if (symbol.flags & SymbolFlags.ExportStar) continue;   // counted once, when followed
      const rootSym = await resolveAlias(ck, symbol);
      const type = await typeOfExport(ck, rootSym);
      // No type is no verdict. "Found no defect" and "was never able to
      // look" are not the same answer, and only one of them is a clean bill.
      if (type === undefined) {
        rows.push({ name, type: '?', kind: 'unaudited', defects: [], why: 'its type could not be resolved' });
        continue;
      }
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
      const found = await walkOne(ck, type, name, owns, rootSym, siblings, functionTypeId, caches, synthesized, claims);
      lost += found.lost;
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
    return { rows, lost, forwarded, unresolved: null };
  } finally {
    await snapshot.dispose?.();
  }
}
