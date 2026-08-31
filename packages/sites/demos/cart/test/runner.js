// Playwright discovers test files by globbing the filesystem before any
// loader hook runs — no loader can make it collect .rip sources, so the
// compiled closure must exist on disk, mirroring the demo root so the
// .rip -> .js specifier rewrite still resolves.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { compile } from '../../../../../src/compile.js'
import { toInlineMapComment } from '../../../../../src/sourcemap.js'

const demo = dirname(import.meta.dirname)
const src = import.meta.dirname
const out = join(src, '.build')

const RELATIVE_RIP = /^(['"])(\.[^'"]*)\.rip\1$/

rmSync(out, { recursive: true, force: true })
const queue = readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.rip')).map((f) => join(src, f))
const seen = new Set(queue)
while (queue.length > 0) {
  const file = queue.shift()
  let result
  try {
    result = compile(readFileSync(file, 'utf8'), { path: file, runtimeDelivery: 'inline' })
  } catch (e) {
    console.error(`${relative(demo, file)}: ${e.message}`)
    process.exit(1)
  }
  for (const node of result.stores?.nodesByKind('dynimport') ?? []) {
    const args = result.stores.role(node.nodeId, 'args')
    if (!args || typeof args.sourceStart !== 'number') continue
    const raw = readFileSync(file, 'utf8').slice(args.sourceStart, args.sourceEnd)
    if (/^\(\s*(['"`])\.[^'"`]*\.rip\1\s*\)$/.test(raw)) {
      console.error(`${relative(demo, file)}: dynamic import of a .rip module — use a static import so the runner can compile and place it`)
      process.exit(1)
    }
  }
  let code = result.code
  for (const span of [...result.imports].reverse()) {
    const m = RELATIVE_RIP.exec(span.specifier)
    if (m === null) continue
    const dep = resolve(dirname(file), `${m[2]}.rip`)
    if (!dep.startsWith(demo + '/')) {
      console.error(`${relative(demo, file)} imports ${span.specifier}, outside the demo root — the build mirrors the demo and cannot place it`)
      process.exit(1)
    }
    if (!seen.has(dep)) { seen.add(dep); queue.push(dep) }
    code = `${code.slice(0, span.start)}${m[1]}${m[2]}.js${m[1]}${code.slice(span.end)}`
  }
  const target = join(out, relative(demo, file).replace(/\.rip$/, '.js'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${code}${code.endsWith('\n') ? '' : '\n'}${toInlineMapComment(result.map)}\n`)
}

execFileSync('bunx', ['playwright', 'test', ...process.argv.slice(2)], {
  cwd: demo,
  stdio: 'inherit',
  env: { ...process.env, CART_RIP_RUNNER: '1' },
})
