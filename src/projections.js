// Client projection extraction — the browser-bundle boundary for
// schemas. A client module may import a named binding from a
// server-only file (`export { UserPublic as User } from '../api/models.rip'`);
// that file cannot ship (it declares :model / ORM). This lifts ONLY the
// named bindings — and only when each is a self-contained shippable
// schema — into synthetic Rip the browser can compile.
//
// Pipeline: parse → foldDerivedSchemas (so Model.pick(...) becomes a
// source-free schema descriptor) → walk the sexpr → refuse :model /
// behavior / non-schemas → emit `export Name = __schema({...})` via
// descriptorSegments. Nested schema-typed fields pull their same-file
// dependencies transitively; a nested type that is not itself shippable
// refuses the whole extract.
import { makeParserLexer } from './lexer.js';
import { Parser } from './parser.js';
import { descriptorSegments, foldDerivedSchemas } from './schema.js';

const BEHAVIOR_TAGS = new Set([
  'computed', 'method', 'hook', 'ensure', 'derived', 'scope', 'defaultScope',
]);

const foldStr = (n) => (n && n.valueOf ? n.valueOf() : n);

const schemaBindingsOf = (sexpr) => {
  const byName = new Map();
  if (!Array.isArray(sexpr)) return byName;
  const head = foldStr(sexpr[0]);
  const stmts = (head === 'program' || head === 'block') ? sexpr.slice(1) : [sexpr];
  for (const stmt of stmts) {
    if (!Array.isArray(stmt)) continue;
    let assign = stmt;
    if (foldStr(stmt[0]) === 'export' && Array.isArray(stmt[1])) assign = stmt[1];
    if (foldStr(assign[0]) !== '=' || !Array.isArray(assign[2])) continue;
    const name = foldStr(assign[1]);
    if (typeof name !== 'string') continue;
    const rhs = assign[2];
    if (foldStr(rhs[0]) === 'schema' && rhs.length === 2 &&
        rhs[1] && typeof rhs[1] === 'object' && Array.isArray(rhs[1].entries)) {
      byName.set(name, rhs[1]);
    }
  }
  return byName;
};

const hasBehavior = (descriptor) => {
  for (const e of descriptor.entries) {
    if (BEHAVIOR_TAGS.has(e.tag)) return true;
    if (e.tag === 'field' && e.transformTokens) return true;
  }
  return false;
};

const emitSchemaRip = (name, descriptor) => {
  const segs = descriptorSegments(descriptor, name, new Map());
  const literal = segs.map((s) => (typeof s === 'string' ? s : '')).join('');
  return `export ${name} = __schema(${literal})`;
};

// extractClientProjections(source, names, { path }) →
//   { ok: true, source } | { ok: false, error }
export function extractClientProjections(source, names, { path } = {}) {
  const filename = path || 'module';
  let sexpr;
  try {
    const parser = Parser();
    parser.lexer = makeParserLexer(filename);
    const result = parser.parse(source);
    if (result.diagnostics.length > 0) {
      const d = result.diagnostics[0];
      return { ok: false, error: `failed to compile ${filename}: ${d.message}` };
    }
    foldDerivedSchemas(result.sexpr);
    sexpr = result.sexpr;
  } catch (e) {
    return { ok: false, error: `failed to compile ${filename}: ${e.message}` };
  }

  const byName = schemaBindingsOf(sexpr);
  const lines = [];
  const errors = [];
  const where = ` from '${filename}'`;
  const requested = new Set(names);
  const seen = new Set();
  const queue = [...names];

  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const descriptor = byName.get(name);
    const isDep = !requested.has(name);
    const tag = isDep
      ? `'${name}'${where} (a nested type of a shipped projection)`
      : `'${name}'${where}`;

    if (!descriptor) {
      errors.push(isDep
        ? `${tag} isn't a shippable schema, so the projection referencing it can't cross to the browser`
        : `${tag} isn't a shippable schema — only a schema or a folded projection (e.g. ${name} = Model.pick(...)) can cross to the browser`);
      continue;
    }
    if (descriptor.kind === 'model') {
      errors.push(`${tag} is a :model — ship a projection like ${name}.pick(...)/.omit(...) instead of the model (which carries ORM/DDL)`);
      continue;
    }
    if (hasBehavior(descriptor)) {
      errors.push(`${tag} carries behavior (methods/computed/transforms) that may close over server-only code — project it to plain fields before importing it client-side`);
      continue;
    }

    lines.push(emitSchemaRip(name, descriptor));
    for (const e of descriptor.entries) {
      if (e.tag !== 'field' || typeof e.typeName !== 'string') continue;
      if (byName.has(e.typeName) && !seen.has(e.typeName)) queue.push(e.typeName);
    }
  }

  if (errors.length) return { ok: false, error: errors.join('; ') };
  return { ok: true, source: lines.join('\n') + '\n' };
}
