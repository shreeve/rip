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

import { ops } from './ops.js';

export class Stores {
  constructor({ nodes, roles, nodeIds = null }) {
    this.nodes = nodes;
    this.roles = roles;
    this.nodeIds = nodeIds;
    this.byId = new Map(nodes.map(n => [n.nodeId, n]));
    // Lookup indexes over the plain row arrays (the arrays stay the
    // source of truth): role() and rolesOf() are called once per mark
    // during emission, so they must be O(1), not row scans.
    this.rolesByNode = new Map();
    for (const r of roles) {
      let forNode = this.rolesByNode.get(r.nodeId);
      if (!forNode) {
        forNode = { list: [], byName: new Map() };
        this.rolesByNode.set(r.nodeId, forNode);
      }
      forNode.list.push(r);
      forNode.byName.set(r.role, r);
    }
  }

  // nodeId for a tree array, via the parser's node → id WeakMap.
  idOf(node) {
    return this.nodeIds?.get(node) ?? null;
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
    if (ops.on) ops.n++;
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
    if (ops.on) ops.n++;
    if (x < node.center) {
      // Every node span ends past the center (> x): match iff start <= x.
      for (const e of node.byStart) {
        if (ops.on) ops.n++;
        if (e.start > x) break;
        out.push(e);
      }
      node = node.left;
    } else if (x > node.center) {
      // Every node span starts at or before the center (< x): match iff end > x.
      for (const e of node.byEnd) {
        if (ops.on) ops.n++;
        if (e.end <= x) break;
        out.push(e);
      }
      node = node.right;
    } else {
      // x IS the center: every node span matches, and neither subtree
      // can (left spans end at or before x, right spans start past it).
      for (const e of node.byStart) {
        if (ops.on) ops.n++;
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
        if (ops.on) ops.n++;
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

  directAtSource(offset) {
    return this.atSource(offset).find(Mappings.isDirect) ?? null;
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
