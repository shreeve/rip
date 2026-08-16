import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execSync } from 'node:child_process'

const files = [
  'dist/@rip/rip.js',
  'src/emitter.js',
  'src/parser.js',
  'src/lexer.js',
  'src/implicit.js',
  'src/ident.js',
  'src/schema.js',
  'src/runtime/schema.js',
  'src/runtime/components.js',
  'src/runtime/orm.js',
  'src/runtime/reactive.js',
  'src/types/schematext.js',
  'src/types/components.js',
  'src/types/dts.js',
  'src/types/typetext.js',
  'src/render.js',
  'src/compile.js',
  'src/builder.js',
  'src/stores.js',
  'src/browser.js',
  'src/cli/repl.js',
  'src/cli/migrate.js',
  'src/cli/check.js',
  'src/runtime/stdlib.js',
  'src/dom.js',
]

function stripComments(src) {
  let out = ''
  let i = 0
  let state = 'code'
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue }
      if (c === "'") { state = 'squote'; out += c; i++; continue }
      if (c === '"') { state = 'dquote'; out += c; i++; continue }
      if (c === '`') { state = 'template'; out += c; i++; continue }
      out += c
      i++
      continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c }
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; i += 2; continue }
      i++
      continue
    }
    if (state === 'squote') {
      out += c
      if (c === '\\') { out += src[++i] ?? ''; i++; continue }
      if (c === "'") state = 'code'
      i++
      continue
    }
    if (state === 'dquote') {
      out += c
      if (c === '\\') { out += src[++i] ?? ''; i++; continue }
      if (c === '"') state = 'code'
      i++
      continue
    }
    if (state === 'template') {
      out += c
      if (c === '\\') { out += src[++i] ?? ''; i++; continue }
      if (c === '`') state = 'code'
      i++
      continue
    }
  }
  return out
}

const kb = (n) => (n / 1024).toFixed(1)
const brotli = (buf) => zlib.brotliCompressSync(buf, {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
})
const minify = new Bun.Transpiler({ loader: 'js', minify: true, target: 'browser' })

const label = process.argv[2] || 'BEFORE'
// Scratch report — covered by root tmp-* gitignore.
const outPath = process.argv[3] || 'tmp-SIZES.md'

const rows = []
for (const file of files) {
  if (!fs.existsSync(file)) continue
  const rawBuf = fs.readFileSync(file)
  const raw = rawBuf.toString('utf8')
  const nocom = stripComments(raw)
  let min
  try {
    min = minify.transformSync(raw)
  } catch {
    min = nocom.replace(/\s+/g, ' ').trim()
  }
  const nocomBuf = Buffer.from(nocom)
  const minBuf = Buffer.from(min)
  rows.push({
    file,
    raw: rawBuf.length,
    nocom: nocomBuf.length,
    min: minBuf.length,
    brRaw: brotli(rawBuf).length,
    brNocom: brotli(nocomBuf).length,
    brMin: brotli(minBuf).length,
    cmtPct: ((rawBuf.length - nocomBuf.length) / rawBuf.length) * 100,
  })
}

const head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
const lines = [
  `# Browser / src size baseline — ${label}`,
  '',
  `Captured: ${new Date().toISOString()}`,
  `Branch: ${execSync('git branch --show-current', { encoding: 'utf8' }).trim()}`,
  `HEAD: ${head}`,
  `Bun: ${Bun.version}`,
  '',
  'Policy: **source keeps comments.** The `.min.js` ship artifact uses standard minify',
  '(comments stripped there only). That is a transfer optimization, not a source style change.',
  '',
  'All sizes in KB. `br*` = brotli quality 11.',
  '',
  '| File | raw | nocom | min | br(raw) | br(nocom) | br(min) | cmt% |',
  '|------|----:|------:|----:|--------:|----------:|--------:|-----:|',
]

for (const r of rows) {
  const name = r.file
    .replace('dist/@rip/', 'dist/')
    .replace(/^src\//, '')
  lines.push(
    `| ${name} | ${kb(r.raw)} | ${kb(r.nocom)} | ${kb(r.min)} | ${kb(r.brRaw)} | ${kb(r.brNocom)} | ${kb(r.brMin)} | ${r.cmtPct.toFixed(0)}% |`,
  )
}

lines.push('')
lines.push('## Notes')
lines.push('')
lines.push('- `dist/@rip/rip.js` is the committed unminified browser bundle.')
lines.push('- Per-file `min` is Bun.Transpiler minify on that file alone.')
lines.push('- `runtime/orm.js` is CLI/server weight; it must stay out of the browser graph.')
lines.push('- Full-graph `rip.min.js` / `.br` sizes are recorded after the bundle script emits them.')
lines.push('')

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, lines.join('\n'))
console.log(`wrote ${outPath} (${rows.length} rows)`)
