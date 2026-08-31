// The .rip spec runner: compiles every .rip under test/ into
// test/.build, then hands the run to Playwright (whose config points
// its testDir there). Playwright's collector globs the filesystem
// before any loader hook runs, so compiled files must exist on disk —
// no loader can make it collect .rip sources. The output directory is
// wiped first, so a stale compile can never shadow an edited spec.
// Extra arguments pass through to `playwright test`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const demo = dirname(import.meta.dirname)
const rip = join(demo, '../../../../bin/rip')
const src = import.meta.dirname
const out = join(src, '.build')

const rips = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === '.build' ? [] : rips(join(dir, e.name)))
  : e.name.endsWith('.rip') ? [join(dir, e.name)] : [])

rmSync(out, { recursive: true, force: true })
for (const file of rips(src)) {
  const target = join(out, relative(src, file).replace(/\.rip$/, '.js'))
  mkdirSync(dirname(target), { recursive: true })
  execFileSync(rip, ['-o', target, '-m', file], { cwd: demo })
  // Compiled output keeps `.rip` on relative specifiers (the runtime
  // loader resolves those; Playwright's node has none) — point them at
  // the compiled neighbors instead. A type-only import never reaches
  // the JS, so the api models are not among them.
  const code = readFileSync(target, 'utf8')
  writeFileSync(target, code.replace(/(from\s*)(['"])(\.[^'"]*)\.rip\2/g, '$1$2$3.js$2'))
}
execFileSync('bunx', ['playwright', 'test', ...process.argv.slice(2)], { cwd: demo, stdio: 'inherit' })
