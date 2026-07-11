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
//   checkAll — coverage policy for the batch checker: check every
//              non-@nocheck file, not just annotated ones. Carried by
//              this seam; the batch checker is its consumer.
//   exclude  — glob list carved out of the batch checker's project
//              walk. Carried by this seam.
//
// Resolution: walk UP to the FIRST package.json and stop — that file
// is the project boundary whether or not it carries a `rip` block. A
// parent repo's config never leaks across a project boundary (a
// standalone app nested inside a larger repo does not inherit that
// repo's `strict`); config is positional to exactly one project.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function readProjectConfig(dir) {
  const config = { strict: false, checkAll: false, exclude: [], _configDir: null };
  try {
    let d = resolve(dir);
    for (;;) {
      const pkgPath = resolve(d, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.rip && typeof pkg.rip === 'object') {
          config.strict = pkg.rip.strict === true;
          config.checkAll = pkg.rip.checkAll === true;
          if (Array.isArray(pkg.rip.exclude)) config.exclude = pkg.rip.exclude.filter((g) => typeof g === 'string');
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
