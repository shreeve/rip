// `rip --explain` — the mapping-table diagnostic instrument. Given a source (or
// generated) position, print the full mapping story the side tables hold
// for it: the containment chain of nodes (innermost first), each node's
// semanticKind, roles, $self span, and MappingStore rows — with both-side
// spans, mappingKind, and whether each row serializes into the V3 map or
// is reverse-only (Mappings.serializableRows() is the single policy
// point; this tool reports its verdict, never re-derives it).
//
// This is a human diagnostic surface — a serialization boundary
// §3): offsets convert to 1-based line:col here, via SourceFile
// lineStarts, for display alongside the offsets themselves.

import { SourceFile } from './source.js';
import { compile } from './compile.js';

// Malformed --explain arguments (not a position error): the CLI exits 2.
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// A well-formed target whose position falls outside the file/line.
export class PositionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PositionError';
  }
}

// `<path>:<offset>` (0-based) or `<path>:<line>:<col>` (1-based).
export function parseTarget(arg) {
  const m = /^(.+?):(\d+)(?::(\d+))?$/.exec(arg);
  if (!m) {
    throw new UsageError(`rip: --explain expects <file.rip>:<offset> or <file.rip>:<line>:<col>, got: ${arg}`);
  }
  const [, path, first, second] = m;
  return second === undefined
    ? { path, pos: { offset: Number(first) } }
    : { path, pos: { line: Number(first), col: Number(second) } };
}

// pos → offset against `file`, rejecting out-of-range positions with a
// message that names the file and the offending position. `label` names
// the coordinate space ('source' | 'generated') in rejections.
//
// The two forms address different things: a raw `offset` addresses any
// in-file UTF-16 code unit, line-terminator bytes included; `line:col`
// addresses VISIBLE text only — the line terminator (`\n`, or `\r\n`
// counted as one terminator) is not a column, so an empty line has zero
// addressable columns. Columns count UTF-16 code units (§3: an astral
// character is two columns wide).
const resolveOffset = (file, path, pos, label) => {
  if (pos.offset !== undefined) {
    if (pos.offset >= file.text.length) {
      throw new PositionError(`${path}: ${label} offset ${pos.offset} is out of range — valid offsets are [0,${file.text.length})`);
    }
    return pos.offset;
  }
  const { line, col } = pos;
  // A trailing newline opens a phantom empty final line in lineStarts;
  // it holds no addressable position, so it does not count here.
  const lines = file.lineCount - (file.text.endsWith('\n') ? 1 : 0);
  if (line < 1 || line > lines) {
    throw new PositionError(`${path}: ${label} line ${line} is out of range — the file has ${lines} line${lines === 1 ? '' : 's'}`);
  }
  const lineStart = file.lineStarts[line - 1];
  // Visible extent: strip the `\n` (when the line has one), then the
  // `\r` of a CRLF pair — one terminator, zero columns.
  let visibleEnd = line < file.lineCount ? file.lineStarts[line] - 1 : file.text.length;
  if (visibleEnd > lineStart && line < file.lineCount && file.text.charCodeAt(visibleEnd - 1) === 13) {
    visibleEnd -= 1;
  }
  const cols = visibleEnd - lineStart;
  if (col < 1 || col > cols) {
    throw new PositionError(`${path}: ${label} position ${line}:${col} is out of range — line ${line} has ${cols} column${cols === 1 ? '' : 's'} (line:col addresses visible text; use a raw offset to address terminator bytes)`);
  }
  return lineStart + col - 1;
};

const lc = (file, offset) => {
  const { line, col } = file.lineColAt(offset);
  return `${line + 1}:${col + 1}`;
};

// `[4,9) 1:5-1:10` — the span as offsets and 1-based line:col, both ends.
const spanStr = (file, start, end) => `[${start},${end}) ${lc(file, start)}-${lc(file, end)}`;

// A text slice fit for one output line: escapes, clipped.
const shown = (text, max = 44) => {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  return escaped.length > max ? `${escaped.slice(0, max - 1)}…` : escaped;
};

// The line at [start, end) with a caret run under the span (clamped to
// the line's extent; zero-width spans get a single caret):
//
//   1 | x = y + 1
//     |     ^^^^^
const excerpt = (file, start, end = start) => {
  const { line, col } = file.lineColAt(start);
  const lineStart = file.lineStarts[line];
  const lineEnd = line + 1 < file.lineStarts.length ? file.lineStarts[line + 1] - 1 : file.text.length;
  const text = file.text.slice(lineStart, lineEnd).replace(/\r$/, '');
  const width = Math.max(1, Math.min(end, lineEnd) - start);
  const gutter = String(line + 1);
  return `  ${gutter} | ${text}\n  ${' '.repeat(gutter.length)} | ${' '.repeat(col)}${'^'.repeat(width)}`;
};

// Rows of cells → aligned lines (columns padded to their widest cell).
const table = (rows, indent = '    ') => {
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => { widths[i] = Math.max(widths[i] ?? 0, cell.length); });
  }
  return rows.map(row =>
    indent + row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ').trimEnd()
  );
};

const nodeLabel = (n) => n.semanticKind !== null ? `#${n.nodeId} ${n.semanticKind}` : `#${n.nodeId} (un-annotated, rule ${n.ruleId})`;

// The mapping rows of one node, grouped $self-first then RoleStore order,
// each group in generated order; roles that only appear in MappingStore
// (none today) would trail in first-appearance order.
const mappingRowsOf = (mappings, stores, nodeId) => {
  const order = ['$self', ...stores.rolesOf(nodeId).map(r => r.role)];
  for (const r of mappings.rows) {
    if (r.nodeId === nodeId && !order.includes(r.role)) order.push(r.role);
  }
  return order.flatMap(role => mappings.of(nodeId, role));
};

// One node's full story: header, roles, mappings.
const nodeSection = (node, { stores, mappings, serialized, srcFile, genFile, code }) => {
  const lines = [];
  lines.push(`${nodeLabel(node)}  $self ${spanStr(srcFile, node.sourceStart, node.sourceEnd)}  \`${shown(srcFile.slice(node.sourceStart, node.sourceEnd))}\``);

  const roles = stores.rolesOf(node.nodeId);
  if (roles.length > 0) {
    lines.push('  roles:');
    lines.push(...table(roles.map(r => {
      const name = r.spread ? `...${r.role}` : r.role;
      if (r.grammarRef === null) {
        return [name, `= ${JSON.stringify(r.literal)}`, '(literal-sourced; no source span)'];
      }
      const cells = [name, spanStr(srcFile, r.sourceStart, r.sourceEnd), `\`${shown(srcFile.slice(r.sourceStart, r.sourceEnd))}\``];
      if (r.childNodeId !== null && r.childNodeId !== undefined) cells.push(`-> #${r.childNodeId}`);
      return cells;
    })));
  }

  const rows = mappingRowsOf(mappings, stores, node.nodeId);
  if (rows.length > 0) {
    lines.push('  mappings:');
    lines.push(...table(rows.map(m => [
      m.role,
      m.mappingKind,
      spanStr(srcFile, m.sourceStart, m.sourceEnd),
      '->',
      spanStr(genFile, m.generatedStart, m.generatedEnd),
      `\`${shown(code.slice(m.generatedStart, m.generatedEnd))}\``,
      serialized.has(m) ? 'V3 map' : 'reverse-only',
    ])));
  } else {
    lines.push('  mappings: none (this node emitted no rows of its own)');
  }
  return lines.join('\n');
};

// --explain: a SOURCE position's story. `face` selects the
// emission surface the story reads against — 'ts' explains the editor
// face's rows (annotation manifestations included); default 'js'.
export function explainSource(source, { path, pos, face = 'js' }) {
  const { code, stores, mappings } = compile(source, { path, face });
  const srcFile = new SourceFile(source, path);
  const genFile = new SourceFile(code);
  const offset = resolveOffset(srcFile, path, pos, 'source');
  const serialized = new Set(mappings.serializableRows());

  const chain = stores.nodes
    .filter(n => n.sourceStart <= offset && offset < n.sourceEnd)
    .sort((a, b) =>
      (a.sourceEnd - a.sourceStart) - (b.sourceEnd - b.sourceStart) || a.nodeId - b.nodeId);

  const out = [];
  out.push(`${path}:${lc(srcFile, offset)} (offset ${offset}) — source position`);
  out.push('');
  out.push(excerpt(srcFile, offset));
  out.push('');

  if (chain.length === 0) {
    out.push('No node contains this position (trivia or inter-construct whitespace).');
    return out.join('\n');
  }

  out.push(`${chain.length} node${chain.length === 1 ? '' : 's'} contain${chain.length === 1 ? 's' : ''} this position (innermost first):`);
  const ctx = { stores, mappings, serialized, srcFile, genFile, code };
  for (const node of chain) {
    out.push('');
    out.push(nodeSection(node, ctx));
  }
  return out.join('\n');
}

// --explain-generated: a GENERATED position resolved back to source.
// With face 'ts', the position addresses the TS face's generated text.
export function explainGenerated(source, { path, pos, face = 'js' }) {
  const { code, stores, mappings } = compile(source, { path, face });
  const srcFile = new SourceFile(source, path);
  const genFile = new SourceFile(code);
  const offset = resolveOffset(genFile, path, pos, 'generated');
  const serialized = new Set(mappings.serializableRows());

  const out = [];
  out.push(`${path} (generated):${lc(genFile, offset)} (offset ${offset}) — generated position`);
  out.push('');
  out.push(excerpt(genFile, offset));
  out.push('');

  const containing = mappings.atGenerated(offset);
  if (containing.length === 0) {
    out.push('No mapping row contains this position (emitter scaffolding outside any recorded span).');
    return out.join('\n');
  }

  out.push(`${containing.length} mapping row${containing.length === 1 ? '' : 's'} contain${containing.length === 1 ? 's' : ''} this position (innermost first):`);
  out.push(...table(containing.map(m => {
    const node = stores.node(m.nodeId);
    const kind = node?.semanticKind ?? `rule ${node?.ruleId}`;
    return [
      `#${m.nodeId} ${kind}.${m.role}`,
      m.mappingKind,
      spanStr(genFile, m.generatedStart, m.generatedEnd),
      '<-',
      spanStr(srcFile, m.sourceStart, m.sourceEnd),
      `\`${shown(code.slice(m.generatedStart, m.generatedEnd))}\``,
      serialized.has(m) ? 'V3 map' : 'reverse-only',
    ];
  }), '  '));

  const best = mappings.bestAtGenerated(offset);
  const node = stores.node(best.nodeId);
  const kind = node?.semanticKind ?? `rule ${node?.ruleId}`;
  out.push('');
  out.push(`bestAtGenerated resolves to #${best.nodeId} ${kind}.${best.role} (${best.mappingKind}) — source ${path}:${lc(srcFile, best.sourceStart)}`);
  out.push('');
  out.push(excerpt(srcFile, best.sourceStart, best.sourceEnd));
  return out.join('\n');
}
