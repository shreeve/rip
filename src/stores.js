// Query layer over the NodeStore/RoleStore rows the generated parser
// returns. The parser module is dependency-free, so it
// accumulates PLAIN row arrays inline; this module wraps them for querying.
//
// NodeStore row: { nodeId, fileId, semanticKind, ruleId, sourceStart,
//   sourceEnd } — one per CONSTRUCTED node, semanticKind null when
//   the producing rule is un-annotated. A node's $self span IS its
//   NodeStore row's span: "$self" is a reserved role name for MappingStore
//   joins, never a RoleStore row.
//
// RoleStore rows:
//   ref role     { nodeId, role, grammarRef, childSlot, sourceStart,
//                  sourceEnd, childNodeId, fileId }
//   spread role  — as ref role, plus spread: true; span covers the spliced
//                  children's full extent; childNodeId null (per-element
//                  spans come from the children's own NodeStore rows)
//   literal role { nodeId, role, grammarRef: null, childSlot, literal,
//                  fileId } — statically-known value, no span
//
// PrimitiveStore row: { nodeId, value, sourceStart, sourceEnd, fileId } —
//   one source token occurrence, owned by the first constructed node that
//   carries it. Primitive tree values cannot carry identity themselves, so
//   their occurrence spans live here and are claimed by source containment
//   while an enclosing node emits.

import { counter } from './counter.js';

export class Stores {
  constructor({ nodes, roles, primitives = [], nodeIds = null }) {
    this.nodes = nodes;
    this.roles = roles;
    this.primitives = primitives;
    this.nodeIds = nodeIds;
    this.byId = new Map(nodes.map(n => [n.nodeId, n]));
    // Lookup indexes over the plain row arrays (the arrays stay the
    // source of truth): role() and rolesOf() are called once per mark
    // during emission, so they must be O(1), not row scans.
    this.rolesByNode = new Map();
    this.primitivesByValue = new Map();
    for (const r of roles) {
      let forNode = this.rolesByNode.get(r.nodeId);
      if (!forNode) {
        forNode = { list: [], byName: new Map() };
        this.rolesByNode.set(r.nodeId, forNode);
      }
      forNode.list.push(r);
      forNode.byName.set(r.role, r);
    }
    for (const p of primitives) {
      let forValue = this.primitivesByValue.get(p.value);
      if (!forValue) this.primitivesByValue.set(p.value, forValue = []);
      forValue.push(p);
    }
    for (const occurrences of this.primitivesByValue.values()) {
      occurrences.sort((a, b) => a.sourceStart - b.sourceStart);
    }
  }

  // nodeId for a tree array, via the parser's node → id WeakMap.
  idOf(node) {
    return this.nodeIds?.get(node) ?? null;
  }

  // Register a lowering's clone of a tree node under the ORIGINAL
  // node's id: the clone's emission is a second generated
  // manifestation of the same source construct, so its marks must
  // resolve to the same rows. No-op when the original carries no id.
  alias(clone, original) {
    const id = this.nodeIds?.get(original);
    if (id != null) this.nodeIds.set(clone, id);
    return clone;
  }

  node(nodeId) {
    return this.byId.get(nodeId) ?? null;
  }

  nodesByKind(kind) {
    return this.nodes.filter(n => n.semanticKind === kind);
  }

  rolesOf(nodeId) {
    return this.rolesByNode.get(nodeId)?.list ?? [];
  }

  role(nodeId, name) {
    return this.rolesByNode.get(nodeId)?.byName.get(name) ?? null;
  }

  // Primitive occurrences inside [sourceStart, sourceEnd), in source order.
  // A role frame supplies its own bounds; $self supplies the node bounds.
  // Filtering by value identifies the primitive spelling while the
  // frame-local claim cursor distinguishes repeated occurrences.
  primitiveSpans(value, sourceStart, sourceEnd) {
    return (this.primitivesByValue.get(value) ?? []).filter((p) =>
      sourceStart <= p.sourceStart && p.sourceEnd <= sourceEnd
    );
  }

  // [start, end) — the node's own span, read from its NodeStore row.
  selfSpan(nodeId) {
    const n = this.byId.get(nodeId);
    return n ? [n.sourceStart, n.sourceEnd] : null;
  }
}

// ── interval index over mapping spans ────────────────────────────────
// A static centered interval tree over half-open spans [start, end):
// each node holds the spans containing its center (sorted by start
// ascending and by end descending), with strictly-left spans below
// `left` and strictly-right below `right`. A stab at offset x visits
// O(log n) nodes and touches only matching spans plus one sentinel per
// node — O(log n + k) against a full scan's O(n). The editor pays this
// query once per diagnostic per publish, where n reaches tens of
// thousands of rows on large files, so scan cost is quadratic in
// aggregate exactly where latency shows.
//
// Entries carry their original row index: results sort by span width
// then row index, which reproduces the previous stable
// filter-then-sort ordering byte-for-byte (a stable sort resolves
// equal widths in original order).
// Entries arrive sorted by start (one global sort); the center is the
// slice's median start in O(1), and an order-preserving partition
// keeps every sublist start-sorted — `byStart` needs no re-sort, and
// only the per-node `byEnd` sorts, so construction is one global sort
// plus O(n log n) cheap passes (build stays a small fraction of a
// compile even at tens of thousands of rows).
const buildIntervalTree = (entries) => {
  if (entries.length === 0) return null;
  const center = entries[entries.length >> 1].start;
  const here = [], left = [], right = [];
  for (const e of entries) {
    if (counter.on) counter.n++;
    if (e.end <= center) left.push(e);
    else if (e.start > center) right.push(e);
    else here.push(e);
  }
  // The median start belongs to some entry, and that entry contains
  // it — `here` is never empty, so each level strictly consumes.
  return {
    center,
    byStart: here,
    byEnd: [...here].sort((a, b) => b.end - a.end),
    left: buildIntervalTree(left),
    right: buildIntervalTree(right),
  };
};

const stabIntervalTree = (root, x, out) => {
  let node = root;
  while (node !== null) {
    if (counter.on) counter.n++;
    if (x < node.center) {
      // Every node span ends past the center (> x): match iff start <= x.
      for (const e of node.byStart) {
        if (counter.on) counter.n++;
        if (e.start > x) break;
        out.push(e);
      }
      node = node.left;
    } else if (x > node.center) {
      // Every node span starts at or before the center (< x): match iff end > x.
      for (const e of node.byEnd) {
        if (counter.on) counter.n++;
        if (e.end <= x) break;
        out.push(e);
      }
      node = node.right;
    } else {
      // x IS the center: every node span matches, and neither subtree
      // can (left spans end at or before x, right spans start past it).
      for (const e of node.byStart) {
        if (counter.on) counter.n++;
        out.push(e);
      }
      break;
    }
  }
  return out;
};

// Query layer over MappingStore rows (produced by CodeBuilder at emission).
// Rows are plain objects: { nodeId, role, mappingKind, sourceStart,
// sourceEnd, generatedStart, generatedEnd, fileId }. One (nodeId, role)
// may own MULTIPLE rows, kept in generated-offset order.
//
// The offset queries answer through the interval index, built lazily
// on the first query (rows are complete by query time) and rebuilt if
// the row count has moved since — the count is the staleness signal
// for an append-only table.
// The roles a caller-supplied span may carry (CodeBuilder.markSpan's
// allowlist): every row under one is a COPY of source bytes the construct's
// own role also places — a companion alias head, a descriptor string, a
// directive comment, a shorthand key — never the construct's own
// manifestation.
export const CALLER_SPAN_ROLES = new Set(['tsDirective', 'shorthandProp', 'identifier', 'literal']);

export class Mappings {
  constructor(rows) {
    this.rows = rows;
    this._genTree = null;
    this._srcTree = null;
    this._genCount = -1;
    this._srcCount = -1;
  }

  // Each side builds on ITS first query only — a diagnostics batch
  // (generated side) never pays for the source index, and vice versa.
  _tree(side) {
    const gen = side === 'generated';
    if ((gen ? this._genCount : this._srcCount) !== this.rows.length) {
      const entries = [];
      this.rows.forEach((r, i) => {
        if (counter.on) counter.n++;
        const start = gen ? r.generatedStart : r.sourceStart;
        const end = gen ? r.generatedEnd : r.sourceEnd;
        // A zero-width span can never satisfy start <= x < end; it
        // stays out of the index entirely.
        if (start != null && start < end) entries.push({ start, end, width: end - start, i });
      });
      entries.sort((a, b) => a.start - b.start || a.i - b.i);
      if (gen) { this._genTree = buildIntervalTree(entries); this._genCount = this.rows.length; }
      else { this._srcTree = buildIntervalTree(entries); this._srcCount = this.rows.length; }
    }
    return gen ? this._genTree : this._srcTree;
  }

  _stab(side, offset) {
    const hits = stabIntervalTree(this._tree(side), offset, []);
    hits.sort((a, b) => a.width - b.width || a.i - b.i);
    return hits.map((e) => this.rows[e.i]);
  }

  // All rows for (nodeId, role), ordered by generated offset.
  of(nodeId, role) {
    return this.rows
      .filter(r => r.nodeId === nodeId && r.role === role)
      .sort((a, b) => a.generatedStart - b.generatedStart);
  }

  // Rows whose generated span contains the offset, innermost first.
  atGenerated(offset) {
    return this._stab('generated', offset);
  }

  // Rows whose source span contains the offset, innermost first.
  atSource(offset) {
    return this._stab('source', offset);
  }

  // Cover-vs-direct policy: a row is DIRECT iff its
  // emitted text corresponds verbatim (exact) or is a synthesized glyph
  // (synthetic). Cover rows are contextual — positions inside hoist lines
  // or block braces resolve to the enclosing cover only via best*().
  //
  // Tie policy: one (nodeId, role) may own several rows (one-to-many
  // — a hoisted declaration and its assignment are two
  // manifestations of the same target role). Singular source-side queries
  // (directAtSource/bestAtSource) resolve such ties by GENERATED order:
  // for `x = y + 1`, source offset 0 returns the `let x` manifestation
  // first. of(nodeId, role) returns all rows in generated order.
  static isDirect(row) {
    return row.mappingKind === 'exact' || row.mappingKind === 'synthetic';
  }

  // Innermost direct row containing the offset, or null.
  directAtGenerated(offset) {
    return this.atGenerated(offset).find(Mappings.isDirect) ?? null;
  }

  // Among the innermost direct rows, the construct's OWN manifestation
  // (a RoleStore role) answers before a caller-spanned copy of the same
  // bytes: a hoisted companion alias head (`type Address = …`) precedes
  // the binding it names (`let Address`) in the face, and a question at
  // the declaration is about the binding. Copies answer, in generated
  // order, only where no own row holds the span.
  directAtSource(offset) {
    const direct = this.atSource(offset).filter(Mappings.isDirect);
    if (direct.length === 0) return null;
    const width = (r) => r.sourceEnd - r.sourceStart;
    const innermost = direct.filter((r) => width(r) === width(direct[0]));
    return innermost.find((r) => !CALLER_SPAN_ROLES.has(r.role)) ?? direct[0];
  }

  // The zero-width exact row AT this source offset, or null. Zero-width
  // spans are invisible to the interval index (a half-open [x, x) contains
  // nothing), so they need their own lookup. The population is holes — the
  // zero-width tokens a tolerant parse minted at the cursor's
  // incompleteness — plus the rare verbatim-empty correspondence (an empty
  // delimiter), for which answering the empty face position is equally
  // right. Several rows can share an offset (a repair can mint several
  // holes at one point); the earliest face position wins — the first hole
  // is the construct the cursor is typing.
  zeroWidthExactAtSource(offset) {
    if (this._zeroSrcCount !== this.rows.length) {
      this._zeroSrc = new Map();
      for (const r of this.rows) {
        if (r.mappingKind !== 'exact' || r.sourceStart !== r.sourceEnd) continue;
        const held = this._zeroSrc.get(r.sourceStart);
        if (held === undefined || r.generatedStart < held.generatedStart) this._zeroSrc.set(r.sourceStart, r);
      }
      this._zeroSrcCount = this.rows.length;
    }
    return this._zeroSrc.get(offset) ?? null;
  }

  // Innermost direct row, falling back to the innermost cover row.
  bestAtGenerated(offset) {
    return this.directAtGenerated(offset) ?? this.atGenerated(offset)[0] ?? null;
  }

  bestAtSource(offset) {
    return this.directAtSource(offset) ?? this.atSource(offset)[0] ?? null;
  }

  // The serialization selection policy — the Source Map V3 serializer
  // consumes THIS, never raw rows. Serialized: `exact` rows and
  // START anchors of `$self` cover rows (lowered construct heads).
  // Synthetic rows never serialize. One candidate per distinct generated
  // start offset: exact beats cover, then innermost (smallest generated
  // span, then smallest source span). Returned in generated order.
  serializableRows() {
    // Zero-width COVER rows never serialize: they are erased
    // constructs (whole-statement type declarations) whose anchor
    // offset belongs to some OTHER construct's emission — exporting
    // it would map that position to source that emitted nothing.
    // They stay fully queryable through the reverse (bestAtSource)
    // path. Zero-width EXACT rows (empty delimiters) still serialize.
    const serializes = (m) =>
      m.mappingKind === 'exact' ||
      (m.mappingKind === 'cover' && m.role === '$self' && m.generatedStart !== m.generatedEnd);
    const exactness = (r) => (r.mappingKind === 'exact' ? 0 : 1);
    const size = (r) => r.generatedEnd - r.generatedStart;
    const srcSize = (r) => r.sourceEnd - r.sourceStart;

    const byStart = new Map();
    for (const m of this.rows) {
      if (!serializes(m)) continue;
      const cur = byStart.get(m.generatedStart);
      if (
        !cur ||
        exactness(m) < exactness(cur) ||
        (exactness(m) === exactness(cur) &&
          (size(m) < size(cur) || (size(m) === size(cur) && srcSize(m) < srcSize(cur))))
      ) {
        byStart.set(m.generatedStart, m);
      }
    }
    return [...byStart.values()].sort((a, b) => a.generatedStart - b.generatedStart);
  }
}
