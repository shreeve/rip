// The declaration beside each runtime the table types, built from the
// table: every name the module exports as an `export declare const`, with
// the face signature where the table has one and `any` where it does not,
// under the alias text the signatures name. A direct importer of the
// runtime's JavaScript reads this file, so the name arrives with the type
// the injected name carries — one contract on both roads. `bun run decls`
// writes the files, test/toolchain/runtime-decls.test.js holds the
// committed bytes to this text, and test/spawn/tsc/runtime-decls-tsc.test.js
// checks each module's JavaScript against its declaration.
import { _runtimeTable, _runtimeExports } from '../emitter.js';
import { CLASS_VALUE_DECL, CSS_PROPERTIES_DECL } from './dom-types.js';
import { DOM_LIB_GLOBALS } from './components.js';

const HEADER = '// Generated from RUNTIME_TABLE in src/emitter.js by `bun run decls`; change the table and regenerate.';

// The aliases the face declares per module where a signature names them
// (domSurfaceDecls); a declaration file carries its own copy.
const FACE_ALIASES = [
  ['__RipClassValue', CLASS_VALUE_DECL],
  ['__RipCSSProperties', CSS_PROPERTIES_DECL],
];

const references = (text, name) => new RegExp(`(?:^|[^\\w$.])${name}(?![\\w$])`).test(text);

export function runtimeDeclarations() {
  const out = [];
  for (const rt of _runtimeTable()) {
    if (!rt.types) continue;
    const exported = _runtimeExports(rt);
    for (const name of new Set([...rt.names, ...Object.keys(rt.types)])) {
      if (!exported.includes(name)) {
        throw new Error(`runtime '${rt.key}' names '${name}' in the table, but its module does not export it`);
      }
    }
    const signatures = Object.values(rt.types).join('\n');
    const lines = [HEADER];
    for (const [alias, decl] of FACE_ALIASES) if (references(signatures, alias)) lines.push(decl);
    if (rt.decls) lines.push(rt.decls);
    for (const name of exported) lines.push(`export declare const ${name}: ${rt.types[name] ?? 'any'};`);
    // A DOM global the declarations name resolves only against the `dom`
    // lib, so the file declares that dependency itself, as a shipped
    // module declaration does (src/ts/dts.js).
    if (DOM_LIB_GLOBALS.some((g) => references(lines.join('\n'), g))) lines.unshift('/// <reference lib="dom" />');
    out.push({
      key: rt.key,
      path: new URL(rt.url.href.replace(/\.js$/, '.d.ts')).pathname,
      text: lines.join('\n') + '\n',
    });
  }
  return out;
}
