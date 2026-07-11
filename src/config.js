// Project configuration — the `package.json#rip` block: the seam
// that makes project-level compiler options real (previously absent
// strict-project opt-in).
//
//   strict   — presentation-only strictness: surface the implicit-any
//              diagnostic family (TS7xxx) instead of suppressing it,
//              and emit typed forwards/pins WITHOUT the `!`
//              definite-assignment assertion so use-before-assign is
//              checked. tsgo itself always runs strict (that is
//              today's behavior for every project); this flag never
//              weakens checking of annotated code — it only decides
//              whether MISSING annotations get complained about.
//   checkAll — coverage policy for the batch checker (`rip check`,
//              future): check every non-@nocheck file, not just
//              annotated ones. Carried, not yet consumed.
//   exclude  — glob list carved out of the batch checker's project
//              walk. Carried, not yet consumed.
//
// Resolution: walk UP to the FIRST package.json and stop — that file
// is the project boundary whether or not it carries a `rip` block. A
// parent repo's config must never leak across a project boundary (a
// standalone app nested inside a larger repo must not inherit that
// repo's `strict`); inheritance, if ever wanted, should be opt-in and
// explicit rather than positional. (The readProjectConfig rule,
// preserved deliberately.)
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
