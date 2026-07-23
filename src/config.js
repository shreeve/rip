// Project configuration — the `package.json#rip` block: the seam
// that makes project-level compiler options real.
//
//   strict   — presentation-only strictness: surface the implicit-any
//              diagnostic family (TS7xxx) instead of suppressing it,
//              and emit typed forwards/pins WITHOUT the `!`
//              definite-assignment assertion so use-before-assign is
//              checked. tsgo always runs strict; this flag never
//              weakens checking of annotated code — it only decides
//              whether MISSING annotations get complained about.
//   noCheck  — glob list of paths NOT type-checked in the editor: their
//              diagnostics are silenced, but the files stay in the
//              program so imports still resolve — the project-glob form
//              of the per-file `# @ts-nocheck` directive. For partly-
//              typed projects quieting untyped/legacy paths.
//   repl     — REPL presentation: { theme: 'dark'|'light'|'mono',
//              colors: { <class>: <ansi name | #hex> } } — consumed by
//              src/repl.js; anything non-object leaves the null default.
//
// Resolution: walk UP to the FIRST package.json and stop — that file
// is the project boundary whether or not it carries a `rip` block. A
// parent repo's config never leaks across a project boundary (a
// standalone app nested inside a larger repo does not inherit that
// repo's `strict`); config is positional to exactly one project.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function readProjectConfig(dir) {
  const config = { strict: false, noCheck: [], repl: null, _configDir: null };
  try {
    let d = resolve(dir);
    for (;;) {
      const pkgPath = resolve(d, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.rip && typeof pkg.rip === 'object') {
          config.strict = pkg.rip.strict === true;
          // Normalize to the canonical string[]: a bare string is a
          // single glob; an array is filtered to its string entries;
          // anything else leaves the [] default.
          const nc = pkg.rip.noCheck;
          if (typeof nc === 'string') config.noCheck = [nc];
          else if (Array.isArray(nc)) config.noCheck = nc.filter((g) => typeof g === 'string');
          if (pkg.rip.repl !== null && typeof pkg.rip.repl === 'object' && !Array.isArray(pkg.rip.repl)) {
            config.repl = pkg.rip.repl;
          }
        }
        config._configDir = d;
        break;
      }
      const parent = dirname(d);
      if (parent === d) break;
      d = parent;
    }
  } catch { /* unreadable/malformed package.json: defaults stand */ }
  return config;
}
