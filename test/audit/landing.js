// The landing engine: a PORTABLE invariant engine for the surfaces that
// answer with a LOCATION rather than text — definition, type
// definition, references, the outline, workspace symbols, document
// links. Like the sweep, its oracle travels with the file: every
// invariant below holds for ANY .rip source, so the engine runs
// anywhere, and the audit runner is one consumer (the Landing lane,
// gated over the closed corpus). Drives the real editor server over
// every NAME the compiler's own lexer produces — the hover census's
// population, names the compiler neither consumed as vocabulary nor
// ruled silent — and judges where each answer lands.
//
// The invariant is the same on every surface: a navigation answer lands
// on a NAME, and the name it lands on is the one that was asked. A span
// whose text is not the asked name is a wrong symbol however plausible;
// a references list that omits the position it was asked from cannot
// be complete; an outline entry whose selection is not its own name, or
// whose name is the lowering's, is not the author's outline; a link whose
// target does not exist is not a link. Locations outside rip (`.ts`,
// `.d.ts`) are TypeScript's own and pass — the lib is not ours to judge.
//
// Classes, each on an answering position unless noted:
//   definition-text        a definition location in a .rip file whose bytes are not the name
//   typedef-text           a type-definition location whose bytes are not an identifier
//   references-text        a references location in a .rip file whose bytes are not the name
//   references-self        a references list that omits the asked position
//   outline-missing        a top-level declaration the outline does not list
//   outline-text           an outline entry whose selection range is not its own name
//   outline-scaffold       an outline entry naming the lowering (`_el3`, `create_block_5`, `__x`)
//   workspace-missing      a top-level declaration a workspace symbol query by its name does not find in its file
//   link-target            a document link whose target does not exist, or whose range is not the path spelled
//   definition-silent      (a DECLINING position) a name with no definition at all — the census half
//   references-silent      (a DECLINING position) a name with no references at all
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(HERE, '..', '..')
const { LspClient } = await import(path.join(repoRoot, 'packages/vscode/src/tsgo.js'))
const { tokenize } = await import(path.join(repoRoot, 'src/lexer.js'))
const { lineStartsOf, offsetToPosition } = await import(path.join(repoRoot, 'packages/vscode/src/translate.js'))
const { censusStarts, ruledSilent } = await import('./sweep.js')
const { compile } = await import(path.join(repoRoot, 'src/compile.js'))
const SERVER = path.join(repoRoot, 'packages/vscode/src/server.js')

const SCAFFOLD_NAME = /^(?:__[A-Za-z$][\w$]*|_(?:el|t|inst|frag|anchor|empty|slot)\d+|_factory[A-Za-z]*|create_block_\d+|_ref\d*)$/
// Words the author writes that TypeScript owns no declaration for — the
// class-body keywords a member regex reads as members — and the RUNTIME's
// member surface: a reactive cell's channel (`value`, `read`, `touch`)
// and a schema companion's API. Their definitions live in the face's own
// preamble, which has no rip source to land on.
const KEYWORD_MEMBERS = new Set(['constructor', 'super', 'this', 'new', 'static', 'get', 'set'])
const RUNTIME_MEMBERS = new Set(['value', 'read', 'touch', 'parse', 'safe', 'ok', 'toJSONSchema', 'pick', 'omit', 'partial', 'required', 'extend', 'derive', 'mount'])
// Top-level declarations: a name at column 0, after an optional keyword
// (def/class/interface/enum/type/export), that the next token makes a
// declaration — an assignment, an annotation, a reactive operator, a
// type-parameter list — never a usage (`console.log(…)`). Heuristic, the
// same one the token audit's inventory takes.
const DECL = /^(?:export\s+)?(?:(def|class|interface|enum|type)\s+)?([A-Za-z_$][\w$]*)/
const NOT_DECL = new Set(['import', 'return', 'if', 'unless', 'for', 'while', 'export', 'switch', 'try', 'throw', 'console', 'p'])
export function topLevelDecls(text) {
  const out = []
  text.split('\n').forEach((lineText, line) => {
    if (/^\s/.test(lineText) || /^\s*#/.test(lineText) || !lineText.trim()) return
    const m = DECL.exec(lineText)
    if (!m || NOT_DECL.has(m[2])) return
    let name = m[2], character = m[0].length - name.length
    const rest = lineText.slice(m[0].length)
    // `Base::member` declares the MEMBER on Base's prototype, never Base.
    const proto = /^(\?*::)([A-Za-z_$][\w$]*)/.exec(rest)
    if (proto) { character += name.length + proto[1].length; name = proto[2] }
    else if (!m[1] && !/^\s*(?::=|~=|=!|=(?!=)|:|<[A-Za-z_$])/.test(rest)) return
    out.push({ name, line, character })
  })
  return out
}
// Names the FACE declares at its top level that the SOURCE does not — the
// runtime preamble's own (`p`, the `__` helpers): a definition answers
// inside the preamble, which has no rip source to land on, so these leave
// the population rather than count as silence.
function runtimeNames(text, fp) {
  let code
  try { code = compile(text, { path: fp, face: 'ts' }).code } catch { return new Set() }
  const declared = (src) => new Set([...src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|def)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]))
  const face = declared(code), source = declared(text)
  return new Set([...face].filter((n) => !source.has(n)))
}
// Every name the AUTHOR declared across a set of sources — the
// population a navigation answer is owed for. A name that hovers but was
// declared by the lib or the runtime (`length`, `parse`, a cell's
// `value`) navigates outside rip or nowhere, and is not this lane's to
// judge. Heuristic over the source text: top-level declarations, members
// and fields (`@x`, `x :=`, `x: T`, `x ~=`), method and function
// parameters, loop variables, import bindings, destructured names.
function declaredNames(texts) {
  const out = new Set()
  for (const text of texts) {
    for (const d of topLevelDecls(text)) out.add(d.name)
    for (const m of text.matchAll(/^\s+@?([A-Za-z_$][\w$]*)\??\s*(?::=|~=|=!|<~|:(?!:)|=(?![=>]))/gm)) out.add(m[1])
    for (const m of text.matchAll(/\(([^()]*)\)\s*(?:->|=>)/g)) {
      for (const part of m[1].split(',')) {
        const p = /^\s*(?:\.\.\.)?@?([A-Za-z_$][\w$]*)/.exec(part)
        if (p) out.add(p[1])
      }
    }
    for (const m of text.matchAll(/\bfor\s+(?:own\s+)?([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s+(?:in|of|as)\b/g)) { out.add(m[1]); if (m[2]) out.add(m[2]) }
    for (const m of text.matchAll(/^(?:export\s+)?import\s+(?:type\s+)?([^\n]+?)\s+from\s/gm)) {
      for (const w of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) if (w[0] !== 'as' && w[0] !== 'type') out.add(w[0])
    }
    for (const m of text.matchAll(/^\s*[\[{]([^\]}\n]*)[\]}]\s*=/gm)) for (const w of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) out.add(w[0])
    for (const m of text.matchAll(/\bcatch\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1])
    for (const m of text.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1])
  }
  return out
}
const textAt = (files, uri, range) => {
  let p
  try { p = fileURLToPath(uri) } catch { return null }
  if (!files.has(p)) {
    try { files.set(p, { text: fs.readFileSync(p, 'utf8') }) } catch { return null }
    files.get(p).lineStarts = lineStartsOf(files.get(p).text)
  }
  const f = files.get(p)
  const s = f.lineStarts[range.start.line] + range.start.character
  const e = f.lineStarts[range.end.line] + range.end.character
  return f.text.slice(s, e)
}
const isRip = (uri) => /\.rip$/.test(uri)
const ripFile = (files, uri) => {
  let p
  try { p = fileURLToPath(uri) } catch { return null }
  if (!files.has(p)) {
    try { files.set(p, { text: fs.readFileSync(p, 'utf8') }) } catch { return null }
    files.get(p).lineStarts = lineStartsOf(files.get(p).text)
  }
  return files.get(p).text
}
const flattenSymbols = (list, out = []) => {
  for (const s of list ?? []) {
    out.push(s)
    if (s.children?.length) flattenSymbols(s.children, out)
  }
  return out
}

export async function landing(wsRoot, files) {
  const published = []
  const client = new LspClient('bun', [SERVER, '--stdio'], {
    onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') published.push(p) },
  })
  client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})))
  await client.request('initialize', {
    processId: process.pid, rootUri: 'file://' + wsRoot,
    capabilities: { workspace: { configuration: true }, textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
  })
  client.notify('initialized', {})
  const findings = []
  const texts = new Map()
  // local name → the name it aliases, taken from every import/export
  // CLAUSE in the set. One map per run: a re-export chain is a property
  // of the module graph, not of the file being asked.
  const aliasOrigins = new Map()
  // …and the same edges the other way: one symbol answers under every
  // spelling the graph gives it, so references asked at the ORIGIN list
  // locations under each alias.
  const aliasedAs = new Map()
  const clauseAliases = (src) => {
    for (const clause of src.matchAll(/\b(?:import|export)\s*(?:type\s+)?\{([^}]*)\}/g)) {
      for (const pair of clause[1].matchAll(/([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g)) {
        if (!aliasOrigins.has(pair[2])) aliasOrigins.set(pair[2], pair[1])
        if (!aliasedAs.has(pair[1])) aliasedAs.set(pair[1], new Set())
        aliasedAs.get(pair[1]).add(pair[2])
      }
    }
  }
  // Per FILE: a name is owed a landing where its author declared it (an
  // import binding declares in the importing file), not wherever another
  // fixture happens to spell the same word.
  const authoredIn = new Map(files.map((rel) => [rel, declaredNames([fs.readFileSync(path.resolve(wsRoot, rel), 'utf8')])]))
  for (const rel of files) clauseAliases(fs.readFileSync(path.resolve(wsRoot, rel), 'utf8'))
  let asked = 0, served = 0
  const WINDOW = 32
  for (const rel of files) {
    const fp = path.resolve(wsRoot, rel)
    const text = fs.readFileSync(fp, 'utf8')
    texts.set(fp, { text, lineStarts: lineStartsOf(text) })
    const uri = pathToFileURL(fp).href
    const before = published.length
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text } })
    for (let i = 0; i < 100 && !published.slice(before).some((p) => p.uri === uri); i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    const lineStarts = lineStartsOf(text)
    const posOf = (off) => offsetToPosition(lineStarts, off)
    const srcLine = (line) => text.slice(lineStarts[line], (lineStarts[line + 1] ?? text.length + 1) - 1).trim().slice(0, 90)
    const row = (off, word, kind, detail) => {
      const { line, character } = posOf(off)
      findings.push({ file: rel, line, ch: character, word, kind, text: detail.slice(0, 300), src: srcLine(line) })
    }
    // The population: every name the lexer produces at a census start.
    // Less the positions a hover RULING already settled as silent (a
    // position that hovers nothing has nothing to navigate from) and the
    // runtime preamble's own names.
    const census = censusStarts(text, fp)
    const ruled = ruledSilent(rel)
    const runtime = runtimeNames(text, fp)
    let names = []
    try {
      for (const t of tokenize(text).tokens) {
        if ((t.kind !== 'IDENTIFIER' && t.kind !== 'PROPERTY') || !census.has(t.start)) continue
        const word = text.slice(t.start, t.end)
        const { line, character } = posOf(t.start)
        if (!/^[A-Za-z_$][\w$]*$/.test(word) || !authoredIn.get(rel).has(word)) continue
        if (KEYWORD_MEMBERS.has(word) || RUNTIME_MEMBERS.has(word)) continue
        if (ruled.has(`${line}:${character}`) || runtime.has(word)) continue
        // A key of the router's query or params (`@router.query.q`) is a
        // string-map lookup: TypeScript owns no declaration for it.
        if (/@router\.(?:query|params)\.$/.test(text.slice(Math.max(0, t.start - 20), t.start))) continue
        names.push({ off: t.start, word })
      }
    } catch { names = [] }
    const covers = (loc, off, len) => {
      if (loc.uri !== uri) return false
      const s = lineStarts[loc.range.start.line] + loc.range.start.character
      const e = lineStarts[loc.range.end.line] + loc.range.end.character
      return s <= off && off + len <= e
    }
    const locs = (r) => (r === null || r === undefined) ? [] : Array.isArray(r) ? r.map((l) => l.targetUri ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l) : [r]
    for (let w = 0; w < names.length; w += WINDOW) {
      const chunk = names.slice(w, w + WINDOW)
      const answers = await Promise.all(chunk.map(async (n) => {
        const position = posOf(n.off)
        const [hover, def, typ, refs] = await Promise.all([
          client.request('textDocument/hover', { textDocument: { uri }, position }),
          client.request('textDocument/definition', { textDocument: { uri }, position }),
          client.request('textDocument/typeDefinition', { textDocument: { uri }, position }),
          client.request('textDocument/references', { textDocument: { uri }, position, context: { includeDeclaration: true } }),
        ])
        return { n, hover, def: locs(def), typ: locs(typ), refs: locs(refs) }
      }))
      for (const { n, hover, def, typ, refs } of answers) {
        // A name the server answers from its OWN records — an element
        // tag, an attribute or event key, the ref and slot channels — has
        // no TS symbol behind it: hover serves the ruled answer and the
        // symbol surfaces decline by construction. Not a silence.
        const head = typeof hover?.contents?.value === 'string' ? hover.contents.value.replace(/```\w*\n?/g, '').trim() : ''
        if (/^(?:\((?:element|attribute|(?:custom )?event|bind|slot|key|rest)\) |ref — )/.test(head)) { served++; continue }
        // An UNTYPED member (`(property) factor: any` on an untyped
        // object) resolves to no declaration anywhere — TypeScript's own
        // limit, not a landing owed.
        if (/^\(property\) [\w$.]+: any$|^any$|: any$/.test(head.replace(/\s+/g, ' '))) { served++; continue }
        // A binding of an AMBIENT wildcard module (`declare module "bun:*"`)
        // has a declaration TypeScript can name but nowhere to land.
        if (/^\(alias\) module "/.test(head)) { served++; continue }
        asked++
        if (def.length === 0) row(n.off, n.word, 'definition-silent', head.slice(0, 80))
        // TypeScript's own conventions for an import: an ALIAS (`port as
        // libPort`) navigates to its origin's name, and a DEFAULT import
        // names the `default` keyword of its export — both are the right
        // landing under another spelling.
        const esc = n.word.replace(/\$/g, '\\$&')
        // The alias's ORIGIN, wherever the module graph spells it. A
        // re-export renames on the way through (`export { UserPublic as
        // User } from './models.rip'`), so the file that ASKS may name
        // neither end: `import { User }` here, `UserPublic` at the
        // landing, and the alias in a third file entirely. Only
        // import/export CLAUSES are read, so a rename pair inside
        // ordinary code can never excuse a wrong landing.
        const origin = aliasOrigins.get(n.word)
          ?? new RegExp(`\\b([A-Za-z_$][\\w$]*) as ${esc}\\b`).exec(text)?.[1] ?? null
        const isDefault = new RegExp(`^import ${esc}\\b|^import type ${esc}\\b|\\bdefault as ${esc}\\b`, 'm').test(text)
        // The other spellings of one symbol across the corpus: an alias
        // bound from the asked name (`host as hubHost`), a default export's
        // declaration (`export default palette`) and every default import
        // of it (`import paired from`, `default as sameTheme`). TypeScript
        // lists all of them as the symbol's references, under their own
        // names, and navigates a default import to the declaration.
        const classes = [...text.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
        const okText = (t, landingUri) => {
          if (t === n.word || (origin !== null && t === origin)) return true
          if (aliasedAs.get(n.word)?.has(t)) return true
          // TypeScript's own landings: a read satisfied by an INDEX
          // SIGNATURE navigates to the signature; a class's references
          // include its `this`; a constructor's include the class name
          // at each `new`.
          if (t !== null && t.startsWith('[')) return true
          if (t === 'this' && classes.includes(n.word)) return true
          if (n.word === 'constructor' && landingUri && new RegExp(`\\bclass\\s+${(t ?? '').replace(/\$/g, '\\$&')}\\b`).test(ripFile(texts, landingUri) ?? '')) return true
          const other = landingUri ? ripFile(texts, landingUri) : null
          if (other === null) return false
          if (new RegExp(`\\b${esc} as ${t.replace(/\$/g, '\\$&')}\\b`).test(other)) return true
          if (isDefault || new RegExp(`^export default ${esc}\\b|\\b${esc} as default\\b`, 'm').test(text)) {
            const te = t.replace(/\$/g, '\\$&')
            return t === 'default' || new RegExp(`^import(?: type)? ${te}\\b|\\bdefault as ${te}\\b|^export default ${te}\\b|\\b${te} as default\\b`, 'm').test(other)
          }
          return false
        }
        // A NAMESPACE import (`* as lib`) names a module, and its definition
        // is the module's file — answered at the file's start, the way a
        // specifier's is.
        const isNamespace = new RegExp(`\\* as ${esc}\\b`).test(text)
        for (const l of def) {
          if (!isRip(l.uri)) continue
          if (isNamespace && l.range.start.line === 0 && l.range.start.character === 0 && l.range.end.line === 0 && l.range.end.character === 0) continue
          const t = textAt(texts, l.uri, l.range)
          if (!okText(t, l.uri)) row(n.off, n.word, 'definition-text', `${path.basename(fileURLToPath(l.uri))}:${l.range.start.line + 1}:${l.range.start.character + 1} → ${JSON.stringify(t)}`)
        }
        for (const l of typ) {
          if (!isRip(l.uri)) continue
          const t = textAt(texts, l.uri, l.range)
          // An anonymous type has no name: TypeScript lands on the type
          // node itself (`{ tone: string }`, `() => void`), which is right.
          if (t !== null && /^[{(\[`]/.test(t)) continue
          if (t === null || !/^[A-Za-z_$][\w$]*$/.test(t)) row(n.off, n.word, 'typedef-text', `${path.basename(fileURLToPath(l.uri))}:${l.range.start.line + 1}:${l.range.start.character + 1} → ${JSON.stringify(t)}`)
        }
        // A name whose definition is outside rip (the lib) is not owed a
        // references list here; one that lands in rip is.
        if (refs.length === 0) { if (def.some((l) => isRip(l.uri))) row(n.off, n.word, 'references-silent', '') }
        else {
          if (!refs.some((l) => covers(l, n.off, n.word.length))) row(n.off, n.word, 'references-self', `${refs.length} locations, none at the asked position`)
          for (const l of refs) {
            if (!isRip(l.uri)) continue
            const t = textAt(texts, l.uri, l.range)
            if (!okText(t, l.uri)) row(n.off, n.word, 'references-text', `${path.basename(fileURLToPath(l.uri))}:${l.range.start.line + 1}:${l.range.start.character + 1} → ${JSON.stringify(t)}`)
          }
        }
      }
    }
    // The outline and the workspace query, per top-level declaration.
    const decls = topLevelDecls(text)
    const outline = flattenSymbols(await client.request('textDocument/documentSymbol', { textDocument: { uri } }))
    const outlineNames = new Set(outline.map((s) => s.name))
    for (const s of outline) {
      if (SCAFFOLD_NAME.test(s.name)) row(0, s.name, 'outline-scaffold', s.name)
      const range = s.selectionRange ?? s.location?.range
      if (range) {
        const t = textAt(texts, s.location?.uri ?? uri, range)
        if (t !== s.name && t !== s.name.replace(/\?$/, '')) row(lineStarts[range.start.line] + range.start.character, s.name, 'outline-text', JSON.stringify(t))
      }
    }
    for (const d of decls) {
      const off = lineStarts[d.line] + d.character
      if (!outlineNames.has(d.name)) row(off, d.name, 'outline-missing', '')
      const found = await client.request('workspace/symbol', { query: d.name })
      const hit = (found ?? []).some((s) => (s.location?.uri === uri) && textAt(texts, uri, s.location.range) === d.name)
      if (!hit) row(off, d.name, 'workspace-missing', `${(found ?? []).length} results for ${JSON.stringify(d.name)}`)
    }
    // Document links: the range spells a path, and the path exists.
    const links = await client.request('textDocument/documentLink', { textDocument: { uri } })
    for (const l of links ?? []) {
      const spelled = textAt(texts, uri, l.range)
      const off = lineStarts[l.range.start.line] + l.range.start.character
      let targetPath = null
      try { targetPath = l.target ? fileURLToPath(l.target) : null } catch { targetPath = null }
      if (targetPath === null || !fs.existsSync(targetPath)) row(off, spelled ?? '', 'link-target', `target ${l.target ?? '∅'}`)
      else if (spelled === null || !targetPath.endsWith(spelled.replace(/^\.\//, '/').replace(/^\.\.\//, '/'))) row(off, spelled ?? '', 'link-target', `range spells ${JSON.stringify(spelled)}, target ${path.basename(targetPath)}`)
    }
    client.notify('textDocument/didClose', { textDocument: { uri } })
  }
  await client.stop()
  return { asked, served, findings }
}

export const corpusSets = () => [
  {
    name: 'corpus', root: path.join(repoRoot, 'test/audit'),
    files: fs.globSync('corpus/{grammar,claims,gradual}/*.rip', { cwd: path.join(repoRoot, 'test/audit') }).sort(),
  },
  // The stash-bearing bucket: an app-shaped tree (index.rip, package.json,
  // app/stash.rip) the editor anchors a stash to, so the gate rows' typed
  // arm has a corpus specimen. Its own root, since discovery walks up
  // from the file to the workspace root.
  {
    name: 'app', root: path.join(repoRoot, 'test/audit/corpus/app'),
    files: fs.globSync('app/**/*.rip', { cwd: path.join(repoRoot, 'test/audit/corpus/app') }).sort(),
  },
]
export async function runLanding(sets = corpusSets()) {
  const out = []
  for (const set of sets) {
    const { asked, served, findings } = await landing(set.root, set.files)
    out.push({ name: set.name, files: set.files.length, asked, served, findings })
  }
  return out
}
export const ORDER = ['definition-text', 'typedef-text', 'references-text', 'references-self', 'outline-missing', 'outline-text', 'outline-scaffold', 'workspace-missing', 'link-target', 'definition-silent', 'references-silent']
export const KIND_NOTES = {
  'definition-text': 'a definition landing on bytes that are not the asked name — a wrong symbol, however plausible',
  'typedef-text': 'a type definition landing on bytes that are not an identifier',
  'references-text': 'a references location whose bytes are not the asked name',
  'references-self': 'a references list that omits the position it was asked from — it cannot be complete',
  'outline-missing': 'a top-level declaration the outline does not list',
  'outline-text': "an outline entry whose selection range is not its own name",
  'outline-scaffold': 'an outline entry naming the lowering — a render local, a block factory, a runtime helper',
  'workspace-missing': 'a top-level declaration a workspace symbol query by its exact name does not find in its own file',
  'link-target': 'a document link whose target does not exist, or whose range does not spell its path',
  'definition-silent': 'a name with no definition at all — the census half: every other class judges an answer, so over-declining is invisible to them; drains through a ruling, like the hover census',
  'references-silent': 'a name with no references at all — the same census half for references',
}
export const GATED = new Set(['definition-text', 'typedef-text', 'references-text', 'references-self', 'outline-missing', 'outline-text', 'outline-scaffold', 'workspace-missing', 'link-target'])
export const kindOf = (f) => f.kind
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
    const { asked, served, findings } = await landing(set.root, set.files)
    console.log(`\n══ ${set.name} ─ ${set.files.length} files · ${asked} names asked · ${served} served by record · ${findings.length} findings`)
    for (const g of organize(findings)) {
      console.log(`\n  ${g.kind} (${g.count})`)
      console.log(`    ${g.note}`)
      for (const e of g.byLine) {
        for (const w of e.words) console.log(`    ${path.basename(e.file)}:${e.line + 1}:${w.ch + 1}  ${w.word}${w.text ? `  → ${w.text}` : ''}  │ ${e.src}`)
      }
    }
  }
  process.exit(0)
}
