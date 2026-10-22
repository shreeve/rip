// The declaration beside each runtime the table types, built from two
// sources that together cover every name the module exports: the runtime
// table's `types` for the names a program receives injected, so a direct
// importer of the runtime's JavaScript reads the type the injected name
// carries — one contract on both roads — and src/ts/runtime-exports.js for
// the module's other exports, which the face never spells. Each export has
// exactly one owner; an export neither names, a companion entry the module
// does not export, and a signature spelling `any` all refuse, so an
// untyped export cannot reach a declaration file. `bun run decls` writes
// the files, test/toolchain/runtime-decls.test.js holds the committed
// bytes to this text, and test/spawn/tsc/runtime-decls-tsc.test.js checks
// each module's JavaScript against its declaration.
import { _runtimeTable, _runtimeExports } from '../emitter.js';
import { CLASS_VALUE_DECL, CSS_PROPERTIES_DECL } from './dom-types.js';
import { DOM_LIB_GLOBALS } from './components.js';
import { RUNTIME_EXPORT_TYPES } from './runtime-exports.js';

const HEADER = '// Generated from RUNTIME_TABLE in src/emitter.js and src/ts/runtime-exports.js by `bun run decls`; change the source and regenerate.';

// The aliases the face declares per module where a signature names them
// (domSurfaceDecls); a declaration file carries its own copy.
const FACE_ALIASES = [
  ['__RipClassValue', CLASS_VALUE_DECL],
  ['__RipCSSProperties', CSS_PROPERTIES_DECL],
];

const references = (text, name) => new RegExp(`(?:^|[^\\w$.])${name}(?![\\w$])`).test(text);

export function runtimeDeclarations({ table = _runtimeTable(), exports = RUNTIME_EXPORT_TYPES } = {}) {
  const out = [];
  for (const rt of table) {
    if (!rt.types) continue;
    const exported = _runtimeExports(rt);
    const companion = exports[rt.key] ?? { types: {} };
    for (const name of new Set([...rt.names, ...Object.keys(rt.types)])) {
      if (!exported.includes(name)) {
        throw new Error(`runtime '${rt.key}' names '${name}' in the table, but its module does not export it`);
      }
    }
    for (const name of Object.keys(companion.types)) {
      if (!exported.includes(name)) {
        throw new Error(`src/ts/runtime-exports.js types '${name}' for runtime '${rt.key}', but its module does not export it`);
      }
      if (name in rt.types) {
        throw new Error(`'${name}' of runtime '${rt.key}' is typed by the table and by src/ts/runtime-exports.js; one owner per export`);
      }
    }
    const declared = [];
    const texts = [];
    for (const name of exported) {
      const signature = resolve(rt, companion, name);
      if (signature === undefined) {
        throw new Error(`runtime '${rt.key}' exports '${name}' with no signature: add one to the table's types (an injected name) or to src/ts/runtime-exports.js`);
      }
      texts.push(signature.class ?? signature);
      declared.push(typeof signature === 'string'
        ? `export declare const ${name}: ${signature};`
        : `export declare class ${name}${signature.extends ? ` extends ${signature.extends}` : ''} ${signature.class}`);
    }
    const signatures = texts.join('\n');
    const lines = [HEADER];
    for (const [alias, decl] of FACE_ALIASES) if (references(signatures, alias)) lines.push(decl);
    if (companion.imports) for (const [from, names] of Object.entries(companion.imports)) lines.push(`import type { ${names.join(', ')} } from '${from}';`);
    if (rt.decls) lines.push(rt.decls);
    if (companion.decls) lines.push(companion.decls);
    lines.push(...declared);
    const text = paragraphs(lines.flatMap((l) => l.split('\n')).map((l) => layout(l))) + '\n';
    const leak = text.split('\n').find((line) => !line.startsWith('//') && !line.startsWith('/**') && references(line, 'any'));
    if (leak) throw new Error(`runtime '${rt.key}': a declaration spells \`any\` — an open value is \`unknown\`: ${leak.trim()}`);
    // A DOM global the declarations name resolves only against the `dom`
    // lib, so the file declares that dependency itself, as a shipped
    // module declaration does (src/ts/dts.js).
    const body = DOM_LIB_GLOBALS.some((g) => references(text, g)) ? `/// <reference lib="dom" />\n${text}` : text;
    out.push({
      key: rt.key,
      path: new URL(rt.url.href.replace(/\.js$/, '.d.ts')).pathname,
      text: body,
    });
  }
  return out;
}

// An export's signature: the table's for an injected name, else the
// companion's — a string, a class body, or a reference to a member of a
// table namespace (`{ namespace, member }`), for a module export the
// namespace also carries, so the two spell one signature.
const resolve = (rt, companion, name) => {
  const signature = rt.types[name] ?? companion.types[name];
  if (signature === undefined || typeof signature === 'string' || signature.class) return signature;
  const namespace = rt.types[signature.namespace];
  if (typeof namespace !== 'string') {
    throw new Error(`'${name}' of runtime '${rt.key}' refers to table namespace '${signature.namespace}', which the table does not type`);
  }
  const text = collapse(namespace);
  const open = text.indexOf('{');
  const member = members(text.slice(open + 1, matching(text, open))).find((m) => m.startsWith(`${signature.member}: `));
  if (!member) {
    throw new Error(`'${name}' of runtime '${rt.key}' refers to '${signature.namespace}.${signature.member}', which that namespace type has no member for`);
  }
  return member.slice(signature.member.length + 2);
};

// A declaration whose body spans lines stands as a paragraph, one blank
// line from its neighbors; consecutive one-line declarations stay packed.
// A comment or an import attaches to the declaration below it.
const paragraphs = (blocks) => {
  const attaches = (block) => block.startsWith('//') || block.startsWith('/**') || block.startsWith('import ');
  const groups = [];
  let pending = [];
  for (const block of blocks) {
    pending.push(block);
    if (!attaches(block)) {
      groups.push({ text: pending.join('\n'), multi: block.includes('\n') });
      pending = [];
    }
  }
  if (pending.length) groups.push({ text: pending.join('\n'), multi: false });
  let out = '';
  groups.forEach((group, i) => {
    if (i > 0) out += group.multi || groups[i - 1].multi ? '\n\n' : '\n';
    out += group.text;
  });
  return out;
};

// One member per line: every brace-delimited body (an object type, an
// overload set, a class body) opens on its line, carries each member on
// its own line two spaces deeper with a closing `;`, and closes on the
// enclosing indent. Members split on the `;` at the body's own depth, so
// a nested body lays out inside its member and a parameter list never
// splits. String and template literals pass through whole (a template
// literal type spells `${`); a comment line and an import stand as written.
export function layout(text, indent = '') {
  if (text.startsWith('//') || text.startsWith('/**') || text.startsWith('import ')) return text;
  return lay(collapse(text), indent);
}

const lay = (text, indent) => {
  let out = '';
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = literalEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (c !== '{') {
      out += c;
      i++;
      continue;
    }
    const close = matching(text, i);
    const inner = text.slice(i + 1, close).trim();
    if (inner === '') {
      out += '{}';
    } else {
      const deeper = indent + '  ';
      out += '{\n' + members(inner).map((m) => `${deeper}${lay(m, deeper)};\n`).join('') + `${indent}}`;
    }
    i = close + 1;
  }
  return out;
};

// Runs of whitespace outside literals become one space, so the source
// spelling (one line, or already laid out) never shows in the output.
const collapse = (text) => {
  let out = '';
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      const end = literalEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (/\s/.test(c)) {
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (out !== '' && j < text.length) out += ' ';
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

const literalEnd = (text, start) => {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === quote) return i + 1;
  }
  throw new Error(`unterminated ${quote} literal in a runtime signature: ${text}`);
};

const matching = (text, open) => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') { i = literalEnd(text, i) - 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error(`unbalanced braces in a runtime signature: ${text}`);
};

const members = (inner) => {
  const found = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "'" || c === '"' || c === '`') { i = literalEnd(inner, i) - 1; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ';' && depth === 0) {
      found.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  found.push(inner.slice(start).trim());
  return found.filter((m) => m !== '');
};
