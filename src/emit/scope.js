// Statement lists and scopes: pattern names, erased statements, the
// analysis-driven hoist and its line, temporaries, and the control
// context loops and functions open.
//
// A member carrier: src/emit/emitter.js installs its instance and static
// members onto Emitter, and the class itself is never constructed.

import { isNode, isNone, wordOf } from '../sexpr.js';
import { PATTERN_LITERALS } from './helpers.js';
import { isTypedWrapper } from './tree.js';
import { Emitter } from './core.js';

export class ScopeMethods {
  // Every name bound by a destructuring pattern (array/object targets,
  // nested patterns, defaults, rests). Elisions bind nothing.
  // `binding` is true for BINDING patterns (params, loop variables):
  // there the `rest x` sugar is a genuine rest element
  // (`([rest a]) ->` compiles to `([...a])`) and its name collects. In
  // TARGET patterns (assignment targets, catch bindings — catch lowers
  // through an assignment) the same shape rejects: "Cannot use
  // 'rest' expression as a destructuring target".
  // `at` carries the nearest enclosing pattern NODE down the walk, and
  // exists only so a rejected word can be positioned: a rejection never
  // positions at a leaf, and an
  // unpositioned error about `false` is unreadable in a file whose source
  // says `no`. The enclosing node's span covers the pattern, which puts
  // the caret on the text the author actually typed.
  patternNames(p, out = [], binding = false, at = null) {
    const word = wordOf(p);
    if (word !== undefined) {
      // A VALUE WORD reaches here already lowered — `no` is the word
      // `false`, because the alias table rewrote it in the scanner before
      // anything decided this was a binding site — the same law the
      // scanner enforces where an annotation makes a value word a binding
      // NAME, one layer over (lexer.js, `rejectValueWordBinding`). A
      // literal is never a legal destructuring target, so the pattern is
      // the place that can still tell: an identifier binds, a literal
      // cannot. Without this the name enters the hoist line and the
      // module emits `let false`, which no JavaScript engine parses.
      if (PATTERN_LITERALS.has(word)) {
        throw this.positionedError(at, `emitter: \`${word}\` cannot be a destructuring target — a value word lowers to its literal before scope exists, so the binding would be unreachable`);
      }
      if (at !== null) this.rejectNonTarget(p, at);
      out.push(word);
      return out;
    }
    if (!isNode(p) || isNone(p)) return out;
    this.rejectCallTarget(p);
    if (at !== null) this.rejectNonTarget(p, at);
    const [h, a] = p;
    if (h === 'array') for (let i = 2; i < p.length; i++) this.patternNames(p[i], out, binding, p);
    else if (h === 'object') {
      for (let i = 2; i < p.length; i++) {
        const pair = p[i];
        if (pair[0] === ':' && pair[1].void !== true) this.patternNames(pair[1].shorthand === true ? pair[2] : pair[3], out, binding, p);
        else if ((pair[0] === '=' && pair[1].void !== true) || pair[0] === '...') this.patternNames(pair[2], out, binding, p);
      }
    } else if (h === 'rest') {
      if (!binding) throw this.positionedError(p, "emitter: Cannot use 'rest' expression as a destructuring target (destructuring rest is spelled '...name')");
      this.patternNames(p[2], out, binding, p);
    }
    // A defaulted ELEMENT is a bare `=` node (`[flag = 5]`), not a
    // `default`, in an array element and as a keyed pair's value alike;
    // a cast or an annotation wraps the target without changing what
    // binds (`[flag as T]` still writes `flag`). Each descends, or the
    // name is invisible to every check keyed on the walk, the hoist
    // included.
    else if (h === '...' || h === 'default' || (h === '=' && a.void !== true) ||
      h === 'cast' || h === 'satisfies' || h === 'typed-var') this.patternNames(p[2], out, binding, p);
    return out;
  }

  static isPattern(x) {
    return isNode(x) && (x[0] === 'object' || x[0] === 'array');
  }

  // A module carries ONE default export; the second rejects here —
  // the emitted module would fail to instantiate, which is the loud
  // error in the wrong place.
  rejectDuplicateDefault(stmts) {
    let seen = null;
    for (const s of stmts) {
      if (!isNode(s) || s[0] !== 'export-default') continue;
      if (seen !== null) {
        throw this.positionedError(s, "emitter: duplicate 'export default' — a module has exactly one default export", seen);
      }
      seen = s;
    }
  }

  // The module's class-DECLARATION names (`class Box`, exported or
  // not). Interface merging joins a same-module interface only to a
  // class declaration — an expression-form class (`A = class`) binds a
  // variable, which no interface merges with.
  static classDeclNames(stmts) {
    const out = new Set();
    for (const s of stmts) {
      if (!isNode(s)) continue;
      const t = s[0] === 'export' && isNode(s[2]) ? s[2] : s;
      const name = t[0] === 'class' ? wordOf(t[2]) : undefined;
      if (name !== undefined) out.add(name);
    }
    return out;
  }

  // Whole statements that ERASE: `type`/`interface` declarations
  // (["type-decl", text]), bare typed forward declarations (the
  // typed-var wrapper in statement position), and bodiless typed-def
  // OVERLOAD signatures (["def-sig", {}, name, params, type] — read
  // only by declaration emission) compile to NOTHING. Every statement
  // list filters them before emission; each filtered statement
  // records zero-width cover rows so its source span still resolves
  // through bestAtSource.
  static isErasedStmt(s) {
    return isNode(s) && (s[0] === 'type-decl' || isTypedWrapper(s) ||
      (s[0] === 'def-sig' && s.length === 5));
  }

  static stripErased(list) {
    return list.filter((s) => !Emitter.isErasedStmt(s));
  }

  // The emission-path filter: live statements come back, erased ones
  // record their rows at the current output position. An overload
  // signature is COHERENT only when a def of the same name follows it
  // in the same statement list — a sig with no implementation would
  // ship a phantom declaration (its erasure leaves nothing to back
  // it), so it rejects here instead.
  //
  // TS-face side channel: a def-sig registers on its implementing def
  // (pendingSigs — the def's emission prints the overload rows
  // adjacent to itself). Each statement comes back in the dialect the
  // caller handed it in.
  liveStmts(list) {
    const live = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (Emitter.isErasedStmt(s)) {
        if (s[0] === 'def-sig') {
          const name = wordOf(s[2]);
          const impl = list
            .slice(i + 1)
            .map((later) => (isNode(later) && later[0] === 'export' ? later[2] : later))
            .find((later) => isNode(later) && later[0] === 'def' && later.length === 5 && wordOf(later[2]) === name);
          if (!impl) {
            throw this.positionedError(s,
              `emitter: overload signature 'def ${name}' has no implementation — ` +
              `a bodiless typed def must be followed by 'def ${name}' with a body in the same block`,
            );
          }
          if (this.ts) {
            const sigs = this.pendingSigs.get(impl) ?? [];
            if (!sigs.includes(s)) {
              sigs.push(s);
              this.pendingSigs.set(impl, sigs);
            }
          }
        }
        this.erasedRows(s);
      } else {
        live.push(s);
      }
    }
    return live;
  }

  // Zero-width mapping rows for an erased statement, anchored at the
  // current output offset: the honest record that this span emits
  // nothing here (mappingKind 'cover' by construction — the empty
  // emitted slice never equals the source).
  erasedRows(stmt) {
    this.mark(stmt, '$self', () => {});
    const roles =
      stmt[0] === 'type-decl' ? ['declaration'] :
      stmt[0] === 'def-sig' ? ['name', 'params', 'returnType', 'typeParams'] :
      ['target', 'annotation'];
    for (const role of roles) this.mark(stmt, role, () => {});
  }

  // Does an enclosing scope declare `name`? Function and program scopes
  // answer through this.scopes (hoists, parameters, imports, const
  // declarations); a block that heads its own bindings (a loop's
  // variables, a catch binding) pushes no scope and answers through its
  // binding-only reactive frame.
  inScope(name) {
    return this.scopes.some((s) => s.has(name)) ||
      this.rframes.some((f) => f.block === true && f.bound.has(name));
  }

  // Index analysis's scope facts — hoists, field plans, reactive frames
  // and predicate bits — for each scope to find as it emits.
  useAnalysis(facts) {
    this.predicates = facts.predicateBits;
    for (const h of facts.hoists) {
      if (h.list === null) this.programHoist = h;
      else if (h.key !== null) {
        if (this.hoists.has(h.key)) throw new Error('emitter: two hoisting scopes share a statement');
        this.hoists.set(h.key, h);
      }
    }
    for (const f of facts.fieldPlans) this.fieldPlans.set(this.stores.idOf(f.value), f);
    for (const f of facts.scopes) {
      if (f.checkOnly) continue;
      const first = f.ownerId === null ? f.stmtIds.find((id) => id !== null) : undefined;
      const key = f.ownerId !== null ? `o${f.ownerId}` : first !== undefined ? `s${first}` : null;
      if (key === null) continue;
      if (this.frames.has(key)) throw new Error('emitter: two scopes share a frame key');
      this.frames.set(key, f);
    }
  }

  // A function scope's hoist: its entries — the targets analysis found
  // no enclosing scope binding and the temps its chains and reference
  // plans need, by name — less the targets that declare in place, and
  // every name the scope declares, its parameters' included. `facts`
  // defaults to the scope whose statement list is `stmts`.
  scopedHoist(stmts, params = [], facts = this.hoistOf(stmts)) {
    const node = this.factNodes(stmts, facts?.first);
    let entries = this.hoistEntries(facts, node);
    const names = new Set(entries.map(([n]) => n));
    for (const p of params) for (const n of this.patternNames(p, [], true)) names.add(n);
    entries = this.applyDeclareInPlace(entries, facts, node);
    this.attachSchemaConsts(entries, this.schemaScopeOf(stmts)?.stories ?? null);
    return { entries, names, itAssigned: facts?.itAssigned ?? false };
  }

  // The facts of the scope whose statement list is `stmts`, found by the
  // list's first node with an id: a statement belongs to one scope. A
  // list of words alone hoists nothing.
  hoistOf(stmts) {
    for (const s of stmts) {
      const id = this.rowIdOf(s);
      if (id === null) continue;
      const facts = this.hoists.get(id);
      if (facts === undefined) throw new Error('emitter: a scope hoists that analysis never met');
      return facts;
    }
    return null;
  }

  // The node a fact names, among the nodes of `list` that emit: a
  // lowering that re-reads a subtree (optionalAssign's key) emits a copy,
  // whose nodes alias the originals' ids, and the copy's temps and
  // declarations are its own. `first` is the node the facts key by.
  factNodes(list, first) {
    const own = (x) => x;
    if (first == null || list.some((s) => s === first)) return own;
    const copy = new Map();
    const walk = (x) => {
      if (!Array.isArray(x)) return;
      const id = this.rowIdOf(x);
      if (id !== null && !copy.has(id)) copy.set(id, x);
      for (const el of x) walk(el);
    };
    for (const s of list) walk(s);
    return (x) => {
      const node = copy.get(this.stores.idOf(x));
      if (node === undefined) throw new Error('emitter: an analysis fact names a node the copied scope lacks');
      return node;
    };
  }

  // A scope's hoist entries, by name: its targets, then the temps its
  // chains and reference plans need. The temps mint here, in the order
  // analysis lists them, as the scope begins to emit.
  hoistEntries(facts, node = (x) => x) {
    const entries = [];
    if (facts === null) return entries;
    for (const [name, decl] of facts.entries) entries.push([name, node(decl), 'target']);
    for (const mid of facts.chains) {
      const n = node(mid);
      entries.push([this.chainTemp(n), n, '$self']);
    }
    this.pushPlanTemps(entries, facts.plans, node);
    if (entries.length > 1) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (this.ts) {
      entries.annotations = new Map();
      for (const [name, owner] of facts.annotations) entries.annotations.set(name, node(owner));
      entries.directives = this.hoistDirectives(facts.forwards);
    }
    return entries;
  }

  // ---- Declare-in-place --------------------------------------------
  //
  // A hoisted binding with no initializer is an evolving `let` to
  // TypeScript: wrong-typed reassignment is never an error, `typeof`
  // reads `undefined`, and a write-only local hovers `any` — the
  // declaration/initialization split suppresses everything a real
  // initializer would teach the checker. For the names analysis's
  // declare-in-place scan proves safe, the emitter therefore declares
  // AT the first write (`let x = …`) instead of hoisting — in BOTH
  // faces identically, so strip-parity holds by construction.
  //
  // Safe means unobservable: the name's textually first occurrence IS
  // that write (values walk before targets, so a self-referential
  // first write disqualifies itself), the write is a direct statement
  // of the declaring scope, and no occurrence of the name sits inside
  // a hoisted `def`. Those three facts close every early-execution
  // vector: a direct read or an earlier closure's read is textually
  // before the write (first-occurrence rule); a function expression,
  // class, or component textually AFTER the write cannot run before
  // it (its value/binding doesn't exist yet — calling the not-yet-
  // assigned name throws either way); a hoisted `def` is the ONE
  // construct callable from above its own statement, so any name its
  // body touches keeps the hoist. Everything else keeps the hoist too
  // (conditional first writes, compounds).
  //
  // A destructuring pattern declares in place under the same rules,
  // decided per STATEMENT: `let {a, b} = v` binds all of its names or
  // none, so every name the pattern binds must qualify, and the pattern
  // must be one a `let` can spell — plain names only, a rest last, no
  // member element. A name such a pattern declares
  // takes no annotation from a later write: TypeScript annotates a
  // pattern only whole, so the annotation would have no manifestation,
  // and the emitter rejects the write instead — the honest spelling
  // renames the element and declares the typed name from it. Split from
  // its declaration a pattern is an assignment EXPRESSION to
  // TypeScript: a shorthand element is an object-literal property whose
  // type is the evolving base, a rest element never narrows, and an
  // array literal loses the tuple the binding pattern would keep — so
  // the hoisted form hovers `(property) name: any` at the very
  // position that declares the name.
  //
  // The decisions land in `declaresInPlace` and `inlineOwners` (the
  // Emitter's constructor), which assign() reads.

  // Take a scope's targets that declare in place off its hoist line, and
  // register each one's declaring statement in declaresInPlace for
  // assign(). A declare-in-place name is still scope-declared, so callers
  // build the scope's names before this.
  applyDeclareInPlace(entries, facts, node = (x) => x) {
    if (facts === null || facts.facts === null) return entries;
    const scan = facts.captures;
    const ownerToDecl = new Map();
    const kept = entries.filter(([name, , role]) => {
      if (role !== 'target' || !scan.get(name)?.inPlace) return true;
      const decl = node(scan.get(name).decl);
      this.declaresInPlace.add(decl);
      // A bare typed forward's annotation re-homes inline at the write
      // (TS-face presentation only). A pattern takes none: analysis keeps
      // a pattern that binds an annotated name on the hoist line.
      const owner = entries.annotations?.get(name);
      if (!Emitter.isPattern(decl[2]) && owner !== undefined && owner !== decl) {
        this.inlineOwners.set(decl, owner);
        ownerToDecl.set(owner, decl);
      }
      return false;
    });
    kept.annotations = entries.annotations;
    kept.schemaConsts = entries.schemaConsts;
    kept.directives = this.reanchorDirectives(entries.directives, ownerToDecl);
    // The names whose first write is a class expression: the set
    // hoistLine repaints.
    kept.classBindings = new Set(facts.classBindings);
    if (this.ts) this.hoistComponentTypes(kept, scan, node);
    kept.pinnable = this.pinCandidates(facts, node);
    return kept;
  }

  // Directives that rode a forward whose annotation re-homed inline
  // re-anchor to the declaring statement (withTsDirectives emits them
  // above it, same place-or-decline rule); the rest stay hoist-line
  // directives.
  reanchorDirectives(directives, ownerToDecl) {
    if (!directives?.length || !ownerToDecl.size) return directives;
    const kept = [];
    for (const d of directives) {
      const decl = d.forwardOwner !== undefined ? ownerToDecl.get(d.forwardOwner) : undefined;
      if (decl === undefined) {
        kept.push(d);
        continue;
      }
      const dirs = this.tsDirectiveMap.get(decl) ?? [];
      dirs.push(d);
      this.tsDirectiveMap.set(decl, dirs);
    }
    return kept;
  }

  // Pin candidates: still-hoisted, unannotated names with a nested
  // occurrence — exactly the shape that breaks TS's evolving inference
  // (TS7034: evolving serves only same-function references) — and a
  // known first write to probe. The key is computed ONCE and carried,
  // never recomputed at the emission site: it is derived from the name,
  // the value slice and the accessor path, and a second site that
  // reproduced two of those three would look right and silently pin
  // nothing.
  pinCandidates(facts, node) {
    const pinnable = new Map();
    for (const [name, first, path] of facts.pinnable) {
      const write = node(first);
      const key = this.pinKey(name, write, path);
      pinnable.set(name, { node: write, key });
      this.pinnables?.push({ name, node: write, path, key });
    }
    return pinnable;
  }

  // The pin cache key for a hoisted name: `${name}@${hash}` over the
  // first write's VALUE source slice — stable while unrelated edits
  // shift offsets, invalidated exactly when the defining expression
  // changes (djb2; collisions merely share a correctly-typed pin).
  pinKey(name, node, path = '') {
    const row = this.roleRow(node, 'value');
    if (!row || row.sourceStart == null || this.b.source === null) return null;
    // The path joins the hash: a pattern's siblings share one assign node,
    // so hashing the value slice alone would give them ONE key and the
    // cache would serve whichever landed first to all of them.
    const slice = path + '\u0000' + this.b.source.slice(row.sourceStart, row.sourceEnd);
    let h = 5381;
    for (let i = 0; i < slice.length; i++) h = ((h * 33) ^ slice.charCodeAt(i)) >>> 0;
    return `${name}@${h.toString(36)}`;
  }

  // Each hoisted name is a second generated manifestation of its first
  // assignment's `target` role, so declaration
  // positions map with zero heuristics. Chain temps carry '$self' —
  // the declared name manifests the chain's MID operand (a cover row).
  //
  // TS face (the hoisted-let strategy): a name whose scope carries
  // a recorded annotation — a typed declaration's or a bare typed
  // forward's — declares as `let x: T`, so its WRITE sites type
  // against the real annotation; unannotated names stay bare and ride
  // TypeScript's evolving-`let` inference. Chain temps are the
  // emitter's own and never annotate.
  //
  // A bare typed FORWARD declares with the definite-assignment
  // assertion (`let y!: T`): the annotation carries no declaration-
  // site initializer, so plain `let y: T` would opt the name into
  // TypeScript's definite-assignment analysis and raise TS2454 on
  // read-before-assign patterns that are LEGAL Rip (hoisted reads
  // yield undefined) — a diagnostic the unannotated twin never draws.
  // Editor diagnostics must not contradict legal Rip semantics.
  // The `!` is a TS-only strippable byte outside the annotation's
  // mark, so the annotation row stays exact and the strip invariant
  // holds. Annotated ASSIGNMENTS (`x: T = v`) keep the plain `let
  // x: T` — their declaration statement assigns.
  //
  // Directives above bare typed forwards print directly above
  // the hoist line — the line their diagnostics land on (`pad` is the
  // indentation the caller already emitted, restored after each
  // directive's newline) — ONLY when the line declares a single name.
  // TypeScript's suppression is line-granular: on a multi-name hoist
  // line one directive would also swallow the SIBLING names'
  // unrelated errors, silently — imprecise, so it declines
  // (place-or-decline) and every error stays visible.
  hoistLine(entries, pad = '') {
    if (entries.length === 1) {
      for (const d of entries.directives ?? []) this.tsDirectiveLine(d, pad);
    }
    this.b.emit('let ');
    entries.forEach(([name, node, role], i) => {
      if (i > 0) this.b.emit(', ');
      const owner = this.ts && role === 'target'
        ? (entries.annotations?.get(name) ?? null) : null;
      const nameStart = this.b.offset;
      this.hoistName(name, node, role, owner);
      if (this.ts && role === 'target' && entries.classBindings?.has(name)) {
        this.classDecls.push([nameStart, this.b.offset]);
      }
      if (this.ts && role === 'target') this.hoistType(entries, name, node, role, owner);
    });
    this.b.emit(';');
  }

  // A body's hoisted `let` line, on its own line one indent inside `ind`.
  bodyHoistLine(hoist, ind) {
    if (hoist.length === 0) return;
    this.b.emit('  '.repeat(ind + 1));
    this.hoistLine(hoist, '  '.repeat(ind + 1));
    this.b.emit('\n');
  }

  // One hoisted name, marked as the declaration it manifests.
  hoistName(name, node, role, owner) {
    // A bare typed forward is the name's DECLARATION, and it erases in
    // place — so this line is its only generated manifestation, and the
    // name marks the forward's own `target` role rather than the first
    // write's. The annotation beside it already comes from that node; the
    // two halves of `let chosen!: number` are one source declaration and
    // map as one. An annotated ASSIGNMENT is its own declaration
    // statement and keeps the first-write manifestation unchanged.
    // Conditioned on the forward carrying a `target` ROW: a wrapper
    // synthesized at emit time has none, and mark() would then drop the name
    // silently rather than fall back to the write's row.
    const ownerId = owner !== null ? this.stores.idOf(owner) : null;
    if (ownerId !== null && isTypedWrapper(owner) && this.stores.role(ownerId, 'target') !== null) {
      this.mark(owner, 'target', () => this.b.emit(name));
      return;
    }
    // A name bound by a PATTERN (`{ host, port: portNumber } = …`) or
    // beside another (`for x, i in …`) has a role that covers more
    // than its own bytes; the hoist marks the name's own occurrence
    // inside that role, so the declaration TypeScript lands on maps
    // to the name and not to the whole pattern.
    const id = this.stores.idOf(node);
    const r = id !== null ? this.stores.role(id, role) : null;
    const roleText = r?.sourceStart != null && this.b.source !== null ? this.b.source.slice(r.sourceStart, r.sourceEnd) : null;
    const own = roleText !== null && roleText !== name ? this.leafSpansIn(node, name, r.sourceStart, r.sourceEnd)[0] : undefined;
    if (own !== undefined) this.b.markSpan(id, 'identifier', own[0], own[1], () => this.b.emit(name));
    else this.mark(node, role, () => this.b.emit(name));
  }

  // The temp caching a chain's middle operand, minted once per operand.
  chainTemp(mid) {
    let name = this.temps.byNode.get(mid);
    if (name === undefined) {
      name = this.freshTempName();
      this.temps.byNode.set(mid, name);
    }
    return name;
  }

  // Each plan's temps as hoist entries.
  pushPlanTemps(entries, plans, node) {
    for (const plan of plans) {
      const n = node(plan.node);
      const temps = this.planTemps(n, plan);
      for (const name of [temps.recv, temps.obj, temps.key]) if (name !== null) entries.push([name, n, '$self']);
    }
  }

  // A reference plan's temps, minted once per assignment. An optional
  // assignment or a synthesized compound re-reads parts of its target,
  // so each part that is not repeat-safe binds once to a temp its scope
  // hoists: a `let`, never an IIFE parameter, so `yield`, `await` and
  // the guard's short-circuit stay in the source function's control
  // context.
  planTemps(node, plan) {
    let temps = this.refPlans.get(node);
    if (temps === undefined) {
      const mint = (base) => {
        const name = this.loopTempName(base);
        this.temps.used.add(name);
        return name;
      };
      temps = { recv: plan.recv ? mint('_ref') : null, obj: plan.obj ? mint('_o') : null, key: plan.key ? mint('_k') : null };
      this.refPlans.set(node, temps);
    }
    return temps;
  }

  // A chain temp is a `let` hoisted at its owning scope, live for that
  // whole scope, so its name is reserved for the module: no later mint
  // (a loop header, a reference plan, a middle-rest source) can take it.
  freshTempName() {
    let name;
    do {
      name = this.temps.n === 0 ? '_ref' : `_ref${this.temps.n}`;
      this.temps.n++;
    } while (this.temps.used.has(name));
    this.temps.used.add(name);
    return name;
  }

  // Loop temporaries (`_i`, `_step`) dodge the module's spelled
  // identifiers against the same used set as chain temps, walking the
  // numbered family from the base spelling (`_i` → `_i1` → `_i2`).
  // loopTempName itself reserves nothing; a caller reserves the name
  // for the module (`temps.used.add`) or for its live range (liveTemp).
  // A catch-pattern parameter (`_err`) needs neither: the destructure
  // opening its handler is its only read, so the handler may reuse it.
  loopTempName(base) {
    let name = base;
    for (let n = 1; this.temps.used.has(name); n++) name = `${base}${n}`;
    return name;
  }

  // A minted name dodges every temp LIVE where it is minted. A
  // construct's scaffold temp (a loop header's `_ref`/`_i`/`_step`, an
  // accumulator, a pick parameter) is live while the construct emits —
  // its body included, which may mint temps of its own. liveTemp mints
  // and reserves the name until the innermost enclosing liveScope
  // closes, so a temp minted inside the body takes another spelling
  // while sibling constructs still share one. A temp whose declaration
  // outlives its construct reserves in the scope that holds the
  // declaration (returnifyLoop's `_result` in a case clause). Each
  // entry remembers the set it joined: a scratch capture
  // (capturedExprText) swaps `temps.used` for a copy, and releasing
  // from the wrong set would drop a name the module reserved.
  liveTemp(base) {
    const name = this.loopTempName(base);
    this.liveReserve(name);
    return name;
  }

  // Reserve a fixed emitter binding until the enclosing liveScope
  // closes; a name already reserved stays as it was.
  liveReserve(name) {
    if (this.temps.used.has(name)) return;
    this.temps.used.add(name);
    this.liveTemps.push([this.temps.used, name]);
  }

  liveScope(fn, kind = 'construct') {
    const mark = this.liveTemps.length;
    this.liveKinds.push(kind);
    try { return fn(); } finally {
      this.liveKinds.pop();
      for (const [used, name] of this.liveTemps.splice(mark)) used.delete(name);
    }
  }

  // Loop/switch context for the bare `break`/`continue` legality
  // check: bodies emitted inside this wrapper may carry a `break`, and
  // a loop's may carry a `continue`; a switch arm is not a loop. A
  // loop's wrapper is also the live scope of its own temps (liveTemp):
  // its header and accumulator temps stay reserved until the whole loop
  // has emitted. A case clause opens none — its temps belong to the
  // switch's block, which every clause shares.
  inCtrl(fn, loop = true) {
    this.ctrlDepth++;
    if (loop) this.loopDepth++;
    try { if (loop) this.liveScope(fn); else fn(); } finally {
      this.ctrlDepth--;
      if (loop) this.loopDepth--;
    }
  }

  // A function body starts outside every loop and switch: a `break` or
  // `continue` in a closure cannot reach the loop the closure sits in.
  // It is also a live scope of its own: a body's temps never land in
  // the switch block the function sits in.
  freshCtrl(fn) {
    const ctrl = this.ctrlDepth, loops = this.loopDepth;
    this.ctrlDepth = 0;
    this.loopDepth = 0;
    try { return this.liveScope(fn, 'body'); } finally {
      this.ctrlDepth = ctrl;
      this.loopDepth = loops;
    }
  }

  // Every runtime identifier the compiler itself emits is registered
  // in RUNTIME_TABLE.generatedNames before emission begins. Source
  // bindings may keep the public spelling for their own references;
  // generated calls always use the collision-free module alias.
  runtimeName(name) {
    const alias = this.runtimeAliases.get(name);
    if (alias === undefined) {
      throw new Error(`emitter invariant: generated runtime name '${name}' is not registered`);
    }
    return alias;
  }
}
