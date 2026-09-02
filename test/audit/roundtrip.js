// The round-trip engine: the surfaces that WRITE into the author's file
// — rename, and the import actions (organize imports, the import quick
// fix) — judged by what the file is afterwards. A portable invariant
// engine like the sweep and the landing: it holds for ANY .rip source,
// the audit runner is one consumer (the Round-trip lane, gated over the
// closed corpus), and the direct entry takes any file set.
//
// The invariant is that an edit surface changes exactly what it names
// and nothing else, and leaves a program. RENAME: every edit replaces
// the renamed name's own bytes with the new name, and each edited file
// still compiles — so the reverse rename is byte-identical by
// construction. ORGANIZE IMPORTS: no byte outside an import line
// changes, the file still compiles, and the diagnostics afterwards are
// the diagnostics before less the unused imports it removed. THE IMPORT
// QUICK FIX: a specifier removed from an existing clause comes back
// through the fix, the file compiles, the name resolves again, and the
// file's import set is the original's.
//
// Classes:
//   rename-bytes          a rename edit replacing bytes that are not the name
//   rename-breaks         a renamed file that no longer compiles
//   rename-refused        (gauge) prepareRename declining at a declaration
//   organize-bytes        organize imports changing a byte outside an import line
//   organize-breaks       an organized file that no longer compiles
//   organize-diagnostics  an organized file whose diagnostics are not the original's less unused imports
//   fix-missing           no import quick fix offered for a specifier removed from a clause
//   fix-breaks            a fixed file that no longer compiles
//   fix-unresolved        a fixed file in which the restored name still does not resolve
//   fix-imports           a fixed file whose import set is not the original's
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(HERE, '..', '..')
const { LspClient } = await import(path.join(repoRoot, 'packages/vscode/src/tsgo.js'))
const { lineStartsOf, offsetToPosition } = await import(path.join(repoRoot, 'packages/vscode/src/translate.js'))
const { compile } = await import(path.join(repoRoot, 'src/compile.js'))
const { topLevelDecls } = await import('./landing.js')
const SERVER = path.join(repoRoot, 'packages/vscode/src/server.js')

const IMPORT_LINE = /^(?:import\b|export\s+(?:\{|\*|type\s+\{).*\bfrom\b)/
// The text with every import and export-list STATEMENT removed — the
// surface organize imports owns. An import runs from its `import` line
// through the line carrying its `from` (a multi-line clause spans
// several), or is the one line of a side-effect import; an export list
// (`export { … }`, with or without a `from`) runs to its closing brace —
// TypeScript's organize merges and sorts those too.
function outsideImports(text) {
  const out = []
  let inside = null
  for (const l of text.split('\n')) {
    if (inside === 'import') { if (/\bfrom\s+['"]/.test(l)) inside = null; continue }
    if (inside === 'export') { if (/\}/.test(l)) inside = null; continue }
    if (/^import\b/.test(l)) { if (!/\bfrom\s+['"]/.test(l) && !/^import\s+['"]/.test(l)) inside = 'import'; continue }
    if (/^export\s+(?:type\s+)?\{/.test(l)) { if (!/\}/.test(l)) inside = 'export'; continue }
    if (/^export\s+\*.*\bfrom\b/.test(l)) continue
    out.push(l)
  }
  return out.join('\n')
}
// Every edit applied bottom-up to `text`.
function applyEdits(text, edits) {
  const ls = lineStartsOf(text)
  const off = (p) => ls[p.line] + p.character
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start) || off(b.range.end) - off(a.range.end))
  let out = text
  for (const e of sorted) out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end))
  return out
}
const compiles = (text, fp) => { try { compile(text, { path: fp, face: 'ts' }); return true } catch { return false } }
// The import set: `module → sorted specifiers` for every import line.
function importSet(text) {
  const out = new Map()
  for (const m of text.matchAll(/^import\s+(?:type\s+)?([^\n]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const names = [...m[1].matchAll(/[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?/g)].map((w) => w[0].replace(/\s+/g, ' ')).filter((w) => w !== 'type').sort()
    out.set(m[2], [...(out.get(m[2]) ?? []), ...names].sort())
  }
  return JSON.stringify([...out.entries()].sort())
}
const codesOf = (diags) => diags.map((d) => String(d.code)).sort()

export async function roundtrip(wsRoot, files) {
  const published = []
  const client = new LspClient('bun', [SERVER, '--stdio'], {
    onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') published.push(p) },
  })
  client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})))
  client.onServerRequest('workspace/applyEdit', () => ({ applied: true }))
  await client.request('initialize', {
    processId: process.pid, rootUri: 'file://' + wsRoot,
    capabilities: { workspace: { configuration: true, applyEdit: true }, textDocument: { rename: { prepareSupport: true }, codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'source.organizeImports'] } } } } },
  })
  client.notify('initialized', {})
  const findings = []
  let renames = 0, organized = 0, fixed = 0
  const versions = new Map()
  const uriOf = (rel) => pathToFileURL(path.resolve(wsRoot, rel)).href
  const relOf = (uri) => path.relative(wsRoot, fileURLToPath(uri))
  const originals = new Map(files.map((rel) => [rel, fs.readFileSync(path.resolve(wsRoot, rel), 'utf8')]))
  // The server publishes twice per change — the parse pass, then the
  // checked pass — so the answer is the newest publish once none has
  // arrived for a settle window.
  const waitDiags = async (uri, since) => {
    let seen = null
    for (let i = 0; i < 200; i++) {
      const count = published.slice(since).filter((p) => p.uri === uri).length
      if (count > 0 && count === seen) return ([...published].reverse().find((p) => p.uri === uri))?.diagnostics ?? []
      seen = count
      await new Promise((r) => setTimeout(r, count > 0 ? 400 : 100))
    }
    return null
  }
  const change = async (rel, text) => {
    const uri = uriOf(rel)
    const v = (versions.get(rel) ?? 1) + 1
    versions.set(rel, v)
    const since = published.length
    client.notify('textDocument/didChange', { textDocument: { uri, version: v }, contentChanges: [{ text }] })
    return waitDiags(uri, since)
  }
  // Every file open at once — a rename reaches importers, and an
  // importer's answer is only judged where it is open.
  const baseline = new Map()
  for (const rel of files) {
    const uri = uriOf(rel)
    const since = published.length
    versions.set(rel, 1)
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text: originals.get(rel) } })
    baseline.set(rel, (await waitDiags(uri, since)) ?? [])
  }
  const row = (rel, line, ch, word, kind, text) => findings.push({ file: rel, line, ch, word, kind, text: text.slice(0, 300), src: (originals.get(rel).split('\n')[line] ?? '').trim().slice(0, 90) })
  for (const rel of files) {
    const text = originals.get(rel)
    const fp = path.resolve(wsRoot, rel)
    const uri = uriOf(rel)
    // ── RENAME every top-level declaration.
    for (const d of topLevelDecls(text)) {
      const position = { line: d.line, character: d.character }
      const prep = await client.request('textDocument/prepareRename', { textDocument: { uri }, position }).catch(() => null)
      if (!prep) { row(rel, d.line, d.character, d.name, 'rename-refused', ''); continue }
      const newName = `${d.name}Renamed`
      const res = await client.request('textDocument/rename', { textDocument: { uri }, position, newName }).catch((e) => ({ error: String(e?.message ?? e) }))
      renames++
      // The row carries the refusal's OWN evidence — the generated bytes
      // the server could not place — not the sentence around it.
      if (!res || res.error) { row(rel, d.line, d.character, d.name, 'rename-refused', /\((".*")\)\s*$/.exec(res?.error ?? '')?.[1] ?? (res?.error ?? 'null')); continue }
      const changes = res.changes ?? Object.fromEntries((res.documentChanges ?? []).map((c) => [c.textDocument.uri, c.edits]))
      for (const [u, edits] of Object.entries(changes)) {
        const target = relOf(u)
        const original = originals.get(target) ?? (fs.existsSync(fileURLToPath(u)) ? fs.readFileSync(fileURLToPath(u), 'utf8') : null)
        if (original === null) continue
        const ls = lineStartsOf(original)
        for (const e of edits) {
          const replaced = original.slice(ls[e.range.start.line] + e.range.start.character, ls[e.range.end.line] + e.range.end.character)
          // TypeScript keeps a re-exported name's PUBLIC spelling: renaming
          // the local behind `export { name }` writes `newName as name`.
          const keepsExport = e.newText === `${newName} as ${d.name}`
          if (replaced !== d.name || (e.newText !== newName && !keepsExport)) row(target, e.range.start.line, e.range.start.character, d.name, 'rename-bytes', `${JSON.stringify(replaced)} → ${JSON.stringify(e.newText)}`)
        }
        const after = applyEdits(original, edits)
        if (!compiles(after, path.resolve(wsRoot, target))) row(target, d.line, d.character, d.name, 'rename-breaks', `after renaming ${d.name} → ${newName}`)
      }
    }
    // ── ORGANIZE IMPORTS, judged by bytes and by the diagnostics afterwards.
    const lines = text.split('\n')
    if (lines.some((l) => IMPORT_LINE.test(l))) {
      const whole = { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines[lines.length - 1].length } }
      const actions = await client.request('textDocument/codeAction', { textDocument: { uri }, range: whole, context: { diagnostics: [], only: ['source.organizeImports'] } }).catch(() => null)
      const edits = actions?.[0]?.edit?.changes?.[uri] ?? []
      if (edits.length > 0) {
        organized++
        const after = applyEdits(text, edits)
        if (outsideImports(after) !== outsideImports(text)) row(rel, edits[0].range.start.line, 0, 'organize', 'organize-bytes', 'a byte outside an import statement changed')
        if (!compiles(after, fp)) row(rel, edits[0].range.start.line, 0, 'organize', 'organize-breaks', 'the organized file does not compile')
        const diags = await change(rel, after)
        // The control is the ORIGINAL text re-checked at this same moment,
        // not the open-time baseline: a workspace with every file open
        // and hundreds of requests behind it can re-judge a file for
        // reasons of its own, and only a difference organize itself made
        // is organize's.
        const control = await change(rel, text)
        const before = codesOf((control ?? baseline.get(rel)).filter((dg) => !(String(dg.code) === '6133' && IMPORT_LINE.test(lines[dg.range.start.line] ?? ''))))
        if (diags === null || JSON.stringify(codesOf(diags)) !== JSON.stringify(before)) row(rel, 0, 0, 'organize', 'organize-diagnostics', `control ${JSON.stringify(before)} organized ${JSON.stringify(diags === null ? null : codesOf(diags))}`)
      }
      // ── THE IMPORT QUICK FIX: drop the first named specifier, take the fix.
      // The specimen: the first relative import clause holding a PLAIN
      // specifier beside at least one other, so dropping it leaves a clause
      // for the fix to merge back into.
      let clause = -1, name = null, dropped = null
      for (let i = 0; i < lines.length && clause < 0; i++) {
        const cm = /^(import\s+\{)([^}]*)(\}\s+from\s+['"]\.\.?\/[^'"]+['"].*)$/.exec(lines[i])
        if (!cm) continue
        const specs = cm[2].split(',').map((s) => s.trim()).filter(Boolean)
        const plain = specs.findIndex((s) => /^[A-Za-z_$][\w$]*$/.test(s))
        if (specs.length < 2 || plain < 0) continue
        clause = i; name = specs[plain]
        dropped = `${cm[1]} ${specs.filter((_, j) => j !== plain).join(', ')} ${cm[3]}`
      }
      if (clause >= 0) {
        {
          const broken = [...lines]; broken[clause] = dropped
          const brokenText = broken.join('\n')
          const diags = (await change(rel, brokenText)) ?? []
          const bls = lineStartsOf(brokenText)
          const target = diags.find((dg) => String(dg.code) === '2304' && brokenText.slice(bls[dg.range.start.line] + dg.range.start.character, bls[dg.range.end.line] + dg.range.end.character) === name)
          // A name whose absence draws no TS2304 (a component used only as a
          // tag lowers past the checker) is no specimen for the fix.
          if (!target) { /* no specimen */ }
          else {
            const actions = await client.request('textDocument/codeAction', { textDocument: { uri }, range: target.range, context: { diagnostics: [target], only: ['quickfix'] } }).catch(() => null)
            // The fix that names the clause's OWN module — another module
            // exporting the same name is a different import, not a restore.
            const moduleOf = /\bfrom\s+(['"][^'"]+['"])/.exec(lines[clause])?.[1] ?? ''
            const fix = (actions ?? []).find((a) => /^(?:Add|Update) import from /.test(a.title) && a.title.includes(moduleOf.slice(1, -1)) && a.edit?.changes?.[uri]?.length)
            if (!fix) row(rel, target.range.start.line, target.range.start.character, name, 'fix-missing', `${(actions ?? []).length} quick fixes, none an import fix`)
            else {
              fixed++
              const after = applyEdits(brokenText, fix.edit.changes[uri])
              if (!compiles(after, fp)) row(rel, clause, 0, name, 'fix-breaks', 'the fixed file does not compile')
              const afterDiags = (await change(rel, after)) ?? []
              if (afterDiags.some((dg) => String(dg.code) === '2304' && after.slice(lineStartsOf(after)[dg.range.start.line] + dg.range.start.character).startsWith(name))) row(rel, clause, 0, name, 'fix-unresolved', `${name} still unresolved after the fix`)
              if (importSet(after) !== importSet(text)) row(rel, clause, 0, name, 'fix-imports', `imports ${importSet(after)} ≠ original ${importSet(text)}`)
            }
          }
          await change(rel, text)
        }
      }
    }
  }
  await client.stop()
  return { renames, organized, fixed, findings }
}

export const corpusSets = () => [
  {
    name: 'corpus', root: path.join(repoRoot, 'test/audit'),
    files: fs.globSync('corpus/{grammar,claims,gradual}/*.rip', { cwd: path.join(repoRoot, 'test/audit') }).sort(),
  },
]
export async function runRoundtrip(sets = corpusSets()) {
  const out = []
  for (const set of sets) {
    const r = await roundtrip(set.root, set.files)
    out.push({ name: set.name, files: set.files.length, ...r })
  }
  return out
}
export const ORDER = ['rename-bytes', 'rename-breaks', 'organize-bytes', 'organize-breaks', 'organize-diagnostics', 'fix-missing', 'fix-breaks', 'fix-unresolved', 'fix-imports', 'rename-refused']
export const KIND_NOTES = {
  'rename-bytes': "a rename edit replacing bytes that are not the renamed name, or inserting something other than the new name — the reverse rename would not restore the file",
  'rename-breaks': 'a renamed file that no longer compiles',
  'organize-bytes': 'organize imports changed a byte outside an import line',
  'organize-breaks': 'an organized file that no longer compiles',
  'organize-diagnostics': "an organized file whose diagnostics are not the original's less the unused imports it removed",
  'fix-missing': 'no import quick fix offered for a specifier dropped from an existing clause',
  'fix-breaks': 'a file the import quick fix left uncompilable',
  'fix-unresolved': 'a file in which the name the quick fix imported still does not resolve',
  'fix-imports': "a fixed file whose import set is not the original's",
  'rename-refused': 'prepareRename or rename declining at a top-level declaration — the census half',
}
export const GATED = new Set(['rename-bytes', 'rename-breaks', 'organize-bytes', 'organize-breaks', 'organize-diagnostics', 'fix-missing', 'fix-breaks', 'fix-unresolved', 'fix-imports'])
export function organize(findings) {
  const groups = []
  for (const kind of ORDER) {
    const rows = findings.filter((f) => f.kind === kind)
    if (rows.length === 0) continue
    const byLine = new Map()
    for (const f of rows) {
      const k = `${f.file}\0${f.line}`
      const e = byLine.get(k) ?? { file: f.file, line: f.line, words: [], src: f.src }
      e.words.push({ word: f.word, ch: f.ch, text: f.text })
      byLine.set(k, e)
    }
    groups.push({ kind, count: rows.length, note: KIND_NOTES[kind], byLine: [...byLine.values()] })
  }
  return groups
}

if (import.meta.main) {
  const explicit = process.argv.slice(2)
  const sets = explicit.length > 0 ? [{ name: 'files', root: repoRoot, files: explicit }] : corpusSets()
  for (const set of sets) {
    const { renames, organized, fixed, findings } = await roundtrip(set.root, set.files)
    console.log(`\n══ ${set.name} ─ ${set.files.length} files · ${renames} renames · ${organized} organized · ${fixed} fixed · ${findings.length} findings`)
    for (const g of organize(findings)) {
      console.log(`\n  ${g.kind} (${g.count})`)
      console.log(`    ${g.note}`)
      for (const e of g.byLine) for (const w of e.words) console.log(`    ${path.basename(e.file)}:${e.line + 1}:${w.ch + 1}  ${w.word}${w.text ? `  → ${w.text}` : ''}  │ ${e.src}`)
    }
  }
  process.exit(0)
}
