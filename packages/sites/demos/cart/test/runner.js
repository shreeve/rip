// Playwright discovers test files by globbing the filesystem before any
// loader hook runs — no loader can make it collect .rip sources, so the
// compiled closure must exist on disk, mirroring the demo root so the
// .rip -> .js specifier rewrite still resolves.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const demo = dirname(import.meta.dirname)
const rip = join(demo, '../../../../bin/rip')
const src = import.meta.dirname
const out = join(src, '.build')

const SPECIFIER = /(from\s+|import\s+)(['"])(\.[^'"]*)\.rip\2/g

rmSync(out, { recursive: true, force: true })
const queue = readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.rip')).map((f) => join(src, f))
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
