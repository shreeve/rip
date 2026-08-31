// The .rip spec runner: compiles every .rip under test/ — plus the
// .rip modules they import, transitively — into test/.build, then
// hands the run to Playwright (whose config points its testDir there).
// Playwright's collector globs the filesystem before any loader hook
// runs, so compiled files must exist on disk — no loader can make it
// collect .rip sources. The output directory is wiped first, so a
// stale compile can never shadow an edited spec.
//
// The build mirrors the demo root (.build/test/…, .build/api/…): a
// value import like util's api/models.rip compiles into place and the
// specifier rewrite below lands on it without any path arithmetic.
// Extra arguments pass through to `playwright test`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const demo = dirname(import.meta.dirname)
const rip = join(demo, '../../../../bin/rip')
const src = import.meta.dirname
const out = join(src, '.build')

const rips = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === '.build' ? [] : rips(join(dir, e.name)))
  : e.name.endsWith('.rip') ? [join(dir, e.name)] : [])

// Relative .rip specifiers surviving into the compiled JS: each is a
// module the run will load, so it joins the compile queue — and is
// then pointed at its compiled neighbor, since the runtime loader that
// resolves .rip is not present under Playwright's node. A type-only
// import never reaches the JS and never rides along.
const SPECIFIER = /(from\s+|import\s+)(['"])(\.[^'"]*)\.rip\2/g

rmSync(out, { recursive: true, force: true })
const queue = rips(src)
const seen = new Set(queue)
while (queue.length > 0) {
  const file = queue.shift()
  const target = join(out, relative(demo, file).replace(/\.rip$/, '.js'))
  mkdirSync(dirname(target), { recursive: true })
  execFileSync(rip, ['-o', target, '-m', file], { cwd: demo })
  const code = readFileSync(target, 'utf8')
  for (const m of code.matchAll(SPECIFIER)) {
    const dep = resolve(dirname(file), m[3] + '.rip')
    if (!seen.has(dep)) { seen.add(dep); queue.push(dep) }
  }
  writeFileSync(target, code.replace(SPECIFIER, '$1$2$3.js$2'))
}
execFileSync('bunx', ['playwright', 'test', ...process.argv.slice(2)], { cwd: demo, stdio: 'inherit' })
