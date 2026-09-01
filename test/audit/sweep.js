// The hover sweep: a PORTABLE invariant engine, not a corpus lane.
// Like the Mapping and Token audits — and unlike the twin/pin lanes —
// its oracle travels with the file: the invariants below hold for ANY
// .rip source, so the engine runs anywhere. The audit runner is one
// consumer (the Sweep lane, gated, pointed at the closed corpus); the
// direct entry below is the other (discovery over real apps, where a
// class the corpus lacks shows up first). Drives the real editor
// server over EVERY BYTE of whatever it is given, printing every
// hover that smells like machinery — the exhaustive
// mechanization of "hover everywhere and look for garbage" — and, in the
// census class, of "hover everywhere and look for silence". It always
// exits 0: what it prints is triage input (leak / taste question /
// classifier artifact), and an invariant graduates into the audit
// contract only when its class list is clean by agreement.
//
// The audit's Sweep lane is the one blessed entry (`bun run audit`,
// gated over the corpus). Direct invocation exists for DISCOVERY over
// files outside the corpus — the cart demo by default, or any set:
//   bun test/audit/sweep.js                 # cart + corpus
//   bun test/audit/sweep.js <file.rip...>   # explicit files
//
// Classes reported per position — every one below judged on an
// ANSWERING position, except `silent-name`, which judges a declining
// one and is the reason over-declining is visible at all:
//   minted        the hover names a `__`-minted spelling the author did
//                 not write at the position (the machinery-decline
//                 doctrine's hard violation)
//   scaffold      same, for the `_elN`-family render locals
//   cover-this    the bare `this: this` cover answer
//   subject:X     the hover's SUBJECT is a symbol other than the word
//                 under the cursor — a cover landing answering about
//                 something else
//   keyword-cover the same misdirection at a rip structure word
//   comment-cover the same misdirection inside a `#` comment (v3
//                 declined comment positions outright)
//   range:N-lines the hover's own range spans 3+ lines — the whole-
//                 construct highlight class
//   silent-name   a NAME the compiler's own lexer produces, and the
//                 editor DECLINES at — the one class defined on a
//                 declining position rather than an answering one
//   unparsed-head the classifier could not name a subject; a bucket for
//                 reading, not a verdict
// plus minted-in-diagnostic for face spellings in published messages.
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dir, '..', '..')
const { LspClient } = await import(path.join(repoRoot, 'packages/vscode/src/tsgo.js'))
const { tokenize } = await import(path.join(repoRoot, 'src/lexer.js'))
const { compile } = await import(path.join(repoRoot, 'src/compile.js'))
// Rip's built-in field-type names and the TS types they answer as — the
// compiler's own table, so `datetime` answering `Date` is the pair it
// declares, never a spelling the sweep guesses.
const { INTRINSIC_FIELD_TYPES } = await import(path.join(repoRoot, 'src/ts/schema.js'))
const SERVER = path.join(repoRoot, 'packages/vscode/src/server.js')

const MINTED = /\b(__[A-Za-z$][\w$]*)/g
const SCAFFOLD = /\b(_(?:el|t|inst|frag|anchor|empty|slot)\d+)\b/g
// The reactive cell ARM — `T | { value: T; read(): T; … }`, the slot
// admission the lowering spells for a shared prop or a `<=>` channel. An
// answer showing one names the face's plumbing, not the author's type; the
// presenters collapse it onto its value type, and a position they do not
// reach is exactly what this catches. A STANDALONE cell is not this: a
// reactive import or a `:=` member IS a cell, and an answer naming it is the
// truth (the reactive-cell presenter chooses the value-first spelling at a
// declaration by its own ruling).
const CELL = /\| \{ value: [^}]*; read\(\)|\{ value: [^}]*; read\(\)[^}]*\} \|/

// ── the NAME census: the other half of the position dimension ────────
//
// Every class above is defined on an ANSWERING position, so a position
// that DECLINES contributes to none of them and over-declining is
// invisible — the walk covers every byte and still cannot report a word
// that went quiet. The census closes that half: the compiler's own
// LEXER names every identifier the file contains, and a name that
// declines is a row.
//
// The oracle is the lexer, and deliberately neither of the two nearer
// ones. Not a regex over the source: it cannot tell a name from an
// annotation's type word or a structure keyword, and the audit is
// forbidden from guessing that by spelling. Not the server's own
// hoverable population: a denominator taken from the instrument under
// test can never report a position that instrument never knew about,
// which is exactly the failure this class exists to catch.
//
// The descent matters as much as the source. A construct that captures
// its own token payload — a schema body's callables, its transforms —
// keeps those tokens off the top-level stream, so a walk that does not
// descend sees a body as one opaque token and reports nothing about it.
const NESTED_TOKENS = ['paramTokens', 'bodyTokens', 'transformTokens', 'argTokens']

// The entry tags whose `start` is the entry's own NAME. The rest record
// the sigil the name follows (`:open`, `@mixin`, `@scope :active`), so a
// span built from their `start` would address punctuation; they join the
// census only once the entry carries its name's own position.
const NAMED_ENTRY_TAGS = new Set([
  'field', 'computed', 'derived', 'method', 'hook', 'union-member',
])

function nameSpans(text) {
  const out = []
  const take = (toks) => {
    for (const t of toks ?? []) {
      if (typeof t.start !== 'number' || t.start === t.end) continue
      if (t.kind === 'IDENTIFIER' || t.kind === 'PROPERTY') out.push([t.start, t.end])
      if (t.kind === 'SCHEMA_BODY') {
        for (const e of t.value?.entries ?? []) {
          // A descriptor entry's own declared NAME is a span it carries
          // rather than a token it holds, so a census built from the
          // token payloads alone would miss exactly the words the body
          // declares. Its TYPE SLOT is not a name and stays out, the same
          // way the lexer's TYPE token keeps an ordinary annotation out:
          // an annotation's own answer is the type-word road's business.
          if (NAMED_ENTRY_TAGS.has(e.tag) && typeof e.start === 'number' && typeof e.name === 'string') {
            out.push([e.start, e.start + e.name.length])
          }
          for (const k of NESTED_TOKENS) take(e[k])
        }
      }
    }
  }
  try { take(tokenize(text).tokens) } catch { return [] }
  return out
}

// The positions a RULING has already settled as silent. They are pinned
// null in the hover audit's own file, so the census reads that rather
// than keeping a second list of the same decisions — a ruled silence
// drains here the moment its pin lands, and can never drift from it.
const HOVER_PINS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'test/audit/hover-pins.json'), 'utf8'))
  } catch { return {} }
})()

function ruledSilent(rel) {
  const base = path.basename(rel)
  const out = new Set()
  for (const p of HOVER_PINS[base]?.positions ?? []) {
    if ((p.expect ?? null) === null) out.add(`${p.line - 1}:${p.character}`)
  }
  return out
}

// A word the LOWERING spends has nowhere to resolve to, and the compiler
// is the one that knows which those are — it names the kind at the site
// it consumes the word, so the census never has to guess from spelling.
// `silences` are the spans a construct owns whole. A file the compiler
// rejects has no census: the editor cannot type it either, so every
// name in it declines, and rows there would say nothing about hover.
function censusStarts(text, fp) {
  const spans = nameSpans(text)
  if (spans.length === 0) return new Set()
  let spent, silences
  try {
    const o = compile(text, { path: fp, face: 'ts' })
    spent = new Set((o.vocabulary ?? []).map((v) => v.start))
    silences = o.silences ?? []
  } catch { return new Set() }
  return new Set(spans
    .filter(([a]) => !spent.has(a) && !silences.some(([s, e]) => a >= s && a < e))
    .map(([a]) => a))
}

// The answered subject: the head form's own name — the served `(kind)`
// heads, then tsgo's declaration heads. Null when no form matches.
function subjectOf(flat) {
  let m
  if ((m = /^\(element\) ([\w-]+):/.exec(flat))) return m[1]
  if ((m = /^constructor ([A-Za-z_$][\w$]*)\(/.exec(flat))) return m[1]
  if ((m = /^\(type parameter\) ([A-Za-z_$][\w$]*)/.exec(flat))) return m[1]
  if ((m = /^\(local (?:class|function)\) ([A-Za-z_$][\w$]*)/.exec(flat))) return m[1]
  if ((m = /^\((?:property|method)\) \(Anonymous class\)\.([A-Za-z_$][\w$]*)/.exec(flat))) return m[1]
  if ((m = /^\(property\) <[\w-]+>\.([A-Za-z_$][\w$]*)/.exec(flat))) return m[1]
  if ((m = /^\((?:custom )?event\) @([\w-]+):/.exec(flat))) return m[1]
  if ((m = /^\(attribute\) ([\w-]+):/.exec(flat))) return m[1]
  if ((m = /^component ([A-Za-z_$][\w$]*)/.exec(flat))) return m[1]
  if (/^ref — /.test(flat)) return 'ref'
  if (/^(?:\(alias\) )?module "/.test(flat)) return '(module)'
  if ((m = /^(?:\(alias\) )*(?:export )?(?:type|interface|class|enum|namespace) ([A-Za-z_$][\w$]*)/.exec(flat))) return m[1]
  if (/^(?:any|unknown|never|string|number|boolean|null|undefined|void)\b/.test(flat) && !flat.includes(':')) return '(bare-type)'
  if (flat === 'this') return 'this'
  // The parenthesized heads: TypeScript's own, and the kinds rip mints in
  // their place — a `(state)`, `(prop)`, `(field)` … head is followed by
  // the same `name:` shape, so the one walk below names its subject.
  const head = /^(?:\(alias\) )*(?:\((?:property|parameter|method|accessor|local class|local function|state|prop|computed|readonly|effect|gate|derived|field|bind|key|slot|rest)\) )?(?:readonly )?(?:const |let |var |function |import )?/.exec(flat)
  if (head !== null) {
    // Walk a dotted name whose segments may carry generic argument
    // lists: `Array<Pick<…>>.slice` names `slice`.
    let i = head[0].length, last = null
    while (i < flat.length) {
      const w = /^[A-Za-z_$][\w$]*/.exec(flat.slice(i))
      if (w === null) break
      last = w[0]; i += w[0].length
      if (flat[i] === '<') {
        let depth = 0
        while (i < flat.length) {
          if (flat[i] === '<') depth++
          else if (flat[i] === '>' && flat[i - 1] !== '=') { if (--depth === 0) { i++; break } }
          i++
        }
      }
      if (flat[i] === '.') { i++; continue }
      break
    }
    if (last !== null && (flat[i] === ':' || flat[i] === '(' || flat[i] === '?' || flat[i] === '!')) return last
  }
  return null
}

// Rip's own structure words: a hover here is a cover landing answering
// about a NEIGHBOR — real, chatty, and its own bucket.
const KEYWORDS = new Set(('if unless else then switch when for while until in of and or not is isnt new return def render '
  + 'component extends class enum type import export from try catch finally throw do break continue slot').split(' '))

async function sweep(wsRoot, files) {
  const published = []
  const client = new LspClient('bun', [SERVER, '--stdio'], {
    onNotification: (m, p) => { if (m === 'textDocument/publishDiagnostics') published.push(p) },
  })
  client.onServerRequest('workspace/configuration', (p) => (p.items ?? []).map(() => ({})))
  await client.request('initialize', {
    processId: process.pid, rootUri: 'file://' + wsRoot,
    capabilities: { workspace: { configuration: true } },
  })
  client.notify('initialized', {})
  const findings = []
  let probes = 0, answered = 0
  for (const rel of files) {
    const fp = path.resolve(wsRoot, rel)
    const text = fs.readFileSync(fp, 'utf8')
    const uri = 'file://' + fp
    const before = published.length
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'rip', version: 1, text } })
    for (let i = 0; i < 100 && !published.slice(before).some((p) => p.uri === uri); i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    const diags = [...published].reverse().find((p) => p.uri === uri)?.diagnostics ?? []
    for (const d of diags) {
      if (MINTED.test(d.message)) {
        findings.push({ file: rel, line: d.range.start.line, ch: d.range.start.character, word: '(diagnostic)', kind: 'minted-in-diagnostic', text: d.message.slice(0, 110) })
      }
      MINTED.lastIndex = 0
    }
    const lineStarts = [0]
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
    const posOf = (off) => {
      let lo = 0, hi = lineStarts.length - 1
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1 }
      return { line: lo, character: off - lineStarts[lo] }
    }
    // EVERY byte offset — the position dimension CLOSED, not sampled:
    // no judgment decides which positions are interesting, so “are
    // there more position rows?” is settled by construction. Each
    // offset classifies from where it falls: inside a word (that
    // word's probe), at a word's END boundary (a real cursor position
    // the end-exclusive served spans do not cover), anywhere else a
    // blank probe.
    const inWord = new Array(text.length + 1).fill(null)
    const atEnd = new Array(text.length + 1).fill(null)
    for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
      for (let i = m.index; i < m.index + m[0].length; i++) inWord[i] = m[0]
      atEnd[m.index + m[0].length] = m[0]
    }
    // One census per file, taken before the walk: the set of offsets a
    // NAME starts at, which is the population the decline check judges,
    // less the positions a ruling has already settled as silent.
    const census = censusStarts(text, fp)
    const ruled = ruledSilent(rel)
    const positions = []
    for (let off = 0; off <= text.length; off++) {
      positions.push(inWord[off] !== null ? { off, word: inWord[off] }
        : atEnd[off] !== null ? { off, word: atEnd[off], boundary: true }
        : { off, word: '', blank: true })
    }
    // A WINDOW of requests in flight, not one: the wire round-trip is
    // the cost, and the answers are position-independent, so latency
    // must not stack once per byte.
    const WINDOW = 32
    for (let w = 0; w < positions.length; w += WINDOW) {
      const chunk = positions.slice(w, w + WINDOW)
      const hovers = await Promise.all(chunk.map((p) => {
        const { line, character } = posOf(p.off)
        return client.request('textDocument/hover', { textDocument: { uri }, position: { line, character } })
      }))
      for (let ci = 0; ci < chunk.length; ci++) {
      const p = chunk[ci]
      const { line, character } = posOf(p.off)
      probes++
      const hover = hovers[ci]
      const value = hover?.contents?.value
      const flat = typeof value === 'string'
        ? value.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').replace(/\s+/g, ' ').trim()
        : ''
      const word = p.word
      const srcLine = text.slice(lineStarts[line], (lineStarts[line + 1] ?? text.length + 1) - 1).trim()
      const row = (kind, hits) => findings.push({ file: rel, line, ch: character, word, kind, text: flat.slice(0, 400), src: srcLine.slice(0, 90), ...(hits ? { hits } : {}) })
      // The census half. Judged at the name's START only, so one row per
      // occurrence rather than one per byte of it, and only where the
      // position declined outright — an answer, right or wrong, is the
      // other classes' business.
      if (typeof value !== 'string') {
        if (census.has(p.off) && !ruled.has(`${line}:${character}`)) row('silent-name')
        continue
      }
      answered++
      // A `__` name the FILE's own source spells is the author's, not
      // the lowering's — `__`-prefixed user members are legal rip.
      const minted = [...new Set([...flat.matchAll(MINTED)].map((mm) => mm[1]).filter((n) => n !== word && !text.includes(n)))]
      if (minted.length) row('minted', minted)
      const scaffold = [...new Set([...flat.matchAll(SCAFFOLD)].map((mm) => mm[1]).filter((n) => n !== word))]
      if (scaffold.length) row('scaffold', scaffold)
      if (flat === 'this: this' && word !== 'this') row('cover-this')
      if (CELL.test(flat)) row('cell')
      // Structural truncation: tsgo cuts very long display types mid-
      // token, and a cut answer is never a right answer. Unbalanced
      // nesting is the cut's fingerprint (rest `...` is balanced).
      if (flat !== '') {
        let d = 0
        for (const ch of flat) {
          if (ch === '{' || ch === '(' || ch === '[') d++
          else if (ch === '}' || ch === ')' || ch === ']') d--
        }
        if (d !== 0) row('truncated')
      }
      if (flat === '') { row('empty'); continue }
      const subj = subjectOf(flat)
      const okPair = (a, b) => a === b || (a === 'class' && b === 'className') || (a === 'for' && b === 'htmlFor')
        // `slot` projects the component's children, and answers about them by ruling.
        || (a === 'slot' && b === 'children')
        // A schema field's intrinsic type word answers the TS type it maps to.
        || INTRINSIC_FIELD_TYPES[a] === b
        // A module answer is only reachable from a specifier's own
        // bytes or a namespace-import name — right wherever it lands.
        || b === '(bare-type)' || b === '(module)'
        // A hyphenated name is ONE author word that the probe's word
        // boundaries cut into segments; each segment asks about the
        // whole, so the answer that spells it is right at every one.
        || (b.includes('-') && b.split('-').includes(a))
        // `import.meta`'s member answers the lib's own ImportMeta,
        // and `.new` answers the constructor it invokes — both the
        // platform's own conventions. The constructor arrives in three
        // spellings and all three are the same right answer: a bare
        // construct signature, a GENERIC one carrying its type-parameter
        // list between the keyword and the parameters, and tsgo's
        // `constructor X(): X` head for a class.
        || (a === 'meta' && b === 'ImportMeta')
        || (a === 'new' && (/: new\s*[<(]/.test(flat) || flat.startsWith('constructor ')))
        // `::` lexes as the `prototype` property it means, and hover
        // there answering `.prototype` is the spelling's own truth.
        || (b === 'prototype' && text.slice(Math.max(0, p.off - 2), p.off + 2).includes('::'))
        // An alias hover names the ORIGIN declaration — tsgo's own
        // convention for renamed imports, informative by design.
        || flat.startsWith('(alias)')
        // The `constructor` word answers its own signature, and a
        // SERVED head is only reachable through its own span (`@` of
        // `@click` serves the event row; a specifier's quote bytes
        // serve the module) — right answers wherever they land.
        || (a === 'constructor' && flat.startsWith('constructor '))
        || /^\((?:custom )?event\) |^\(element\) |^ref — |^component /.test(flat)
      // A non-word position has no symbol to ask about, and a word's
      // END boundary asks about a word the answer never names — ANY
      // answer at either is a cover landing.
      if (word === '') {
        // The bias adopts a byte after a word into that word, and the
        // pair rules judge exactly as they would there.
        const adopted = p.off > 0 ? (inWord[p.off - 1] ?? atEnd[p.off - 1] ?? '') : ''
        if (subj !== null && okPair(adopted, subj)) continue
        row('blank-cover'); continue
      }
      // A boundary probe judges by the SAME pair rules: the bias makes
      // the position the word's own, so a boundary answer is wrong
      // exactly when the word's answer would be.
      if (p.boundary) {
        const named = new RegExp(`(^|[^\\w$])${word.replace(/\$/g, '\\$&')}([^\\w$]|$)`).test(flat)
        if (!named && subj !== null && !okPair(word, subj)) { row('boundary-cover'); continue }
        if (!named && subj === null) { row('boundary-cover'); continue }
        continue
      }
      const inComment = text.slice(lineStarts[line], p.off).replace(/#\{/g, '').includes('#')
      if (subj !== null && !okPair(word, subj)) row(inComment ? 'comment-cover' : KEYWORDS.has(word) ? 'keyword-cover' : 'subject:' + subj)
      else if (subj === null && flat !== 'this: this') row(inComment ? 'comment-cover' : KEYWORDS.has(word) ? 'keyword-cover' : 'unparsed-head')
      if (hover.range && hover.range.end.line - hover.range.start.line >= 2) {
        row(`range:${hover.range.end.line - hover.range.start.line + 1}-lines`)
      }
      }
    }
    client.notify('textDocument/didClose', { textDocument: { uri } })
  }
  await client.stop()
  // Detection is per BYTE (the closed position dimension); the REPORT
  // is per finding — every byte of a leaking word repeats the same
  // answer, and counting each would make the gate's number mean
  // “letters in the leak”, not leaks.
  const seenRow = new Map()
  const deduped = []
  for (const f of findings) {
    // The word is NOT in the key: a leak's start, boundary, and the
    // blank byte after it all repeat one answer, and the row's unit is
    // the leak. First-seen wins, which is the wordful probe. The census
    // class is the exception its own unit demands: it has no answer to
    // key on and fires once per NAME already, so two silent names on one
    // line are two rows rather than one.
    const k = [f.file, f.line, f.kind, f.text, f.kind === 'silent-name' ? f.ch : ''].join('\0')
    if (seenRow.has(k)) continue
    seenRow.set(k, true)
    deduped.push(f)
  }
  return { probes, answered, findings: deduped }
}

// The corpus set is the AUDIT's population — the closed, curated
// fixtures every lane measures, so the gate's exit never depends on a
// file outside test/audit. The cart set is DISCOVERY: a living app in
// a direct `bun test/audit/sweep.js` run, where a class the corpus lacks shows up
// first — and then earns a corpus fixture, which is where permanence
// lives.
// The population is every VALID corpus program — no working fixture sits
// outside the net, so the position dimension's denominator is closed over
// the programs the editor is meant to serve. The errors bucket stays out
// on subject grounds, not on cost: those fixtures describe programs that
// do not type, so an answer there is degraded by the program's own
// unresolved symbols and a misdirection row would be evidence about the
// error state rather than about the lowering.
export const corpusSets = () => [
  {
    name: 'corpus', root: path.join(repoRoot, 'test/audit'),
    files: fs.globSync('corpus/{grammar,claims,gradual}/*.rip', { cwd: path.join(repoRoot, 'test/audit') }).sort(),
  },
]
export const defaultSets = () => [
  {
    name: 'cart', root: repoRoot,
    files: fs.globSync('packages/sites/demos/cart/app/**/*.rip', { cwd: repoRoot }).sort(),
  },
  ...corpusSets(),
]

// The whole sweep, one result row per set — the runner's lane and the
// CLI below consume the same engine.
export async function runSweep(sets = defaultSets()) {
  const out = []
  for (const set of sets) {
    // Shard the files across a small server pool (the runner's own
    // probe passes use the same width); each shard is its own server,
    // so one program per document holds within a shard exactly as it
    // did for the single client.
    const POOL = Math.min(4, set.files.length)
    const shards = Array.from({ length: POOL }, () => ({ files: [], weight: 0 }))
    const sized = set.files.map((f) => ({ f, size: fs.statSync(path.resolve(set.root, f)).size })).sort((a, b) => b.size - a.size)
    for (const { f, size } of sized) {
      const lightest = shards.reduce((a, b) => (a.weight <= b.weight ? a : b))
      lightest.files.push(f)
      lightest.weight += size
    }
    const results = await Promise.all(shards.filter((sh) => sh.files.length).map((sh) => sweep(set.root, sh.files)))
    const merged = { probes: 0, answered: 0, findings: [] }
    for (const r of results) { merged.probes += r.probes; merged.answered += r.answered; merged.findings.push(...r.findings) }
    merged.findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ch - b.ch)
    out.push({ name: set.name, files: set.files.length, ...merged })
  }
  return out
}

export const ORDER = ['minted', 'scaffold', 'cover-this', 'cell', 'minted-in-diagnostic', 'truncated', 'empty', 'range', 'subject', 'silent-name', 'boundary-cover', 'blank-cover', 'keyword-cover', 'comment-cover', 'unparsed-head']
// One line per class: what a row MEANS and what drains the class —
// printed under each section header so the report reads without the
// file comment in hand.
export const KIND_NOTES = {
  'minted': 'the answer names a minted `__` spelling — the machinery doctrine\'s hard violation; each row is its own bug',
  'scaffold': 'the answer names a `_elN`-family render local — same doctrine, scaffold shape',
  'cover-this': 'the bare `this: this` cover answer — same doctrine, receiver shape',
  'minted-in-diagnostic': 'a face spelling in a published diagnostic message',
  'range': 'the hover\'s own range spans 3+ lines — the whole-construct highlight; drains when the range clamps to the word',
  'subject': 'the answer is about a DIFFERENT symbol than the word under the cursor — a cover landing; literal interiors and new.target decline by ruling, so any row here is new',
  'keyword-cover': 'a rip structure word answering about a neighbor; drains with the keyword-decline rule (`def` answering its own declaration may be kept deliberately)',
  'comment-cover': 'a word inside a `#` comment answering a neighboring symbol; one comment-decline rule drains the whole class',
  'unparsed-head': 'the classifier could not name the answer\'s subject — a triage bucket; most rows resolve by teaching the classifier the head form, not by fixing the editor',
  'truncated': "the answer's nesting does not balance — tsgo cut a very long display type mid-token; a cut answer is never a right answer",
  'cell': 'an answer showing a reactive cell ARM beside its value type (`T | { value: T; read(): T; … }`) — the slot admission every presenter collapses onto T; a position none of them reaches. A standalone cell is a thing the author holds and is not this',
  'empty': 'an answer whose fence is blank',
  'silent-name': 'a name the lexer produces that the editor declines at; the census half of the position dimension — every other class judges an answer, so over-declining is invisible to them; drains through a ruling and its pin, like every other class',
  'boundary-cover': "a cursor at a word's END boundary answers about something the word never named — the served spans are end-exclusive",
  'blank-cover': 'a non-word position (indentation, past end of line) answers — ANY answer here is a cover landing',
}
// The chatty classes report per file+line, not per word: their unit of
// fixing is the rule, so the useful map is WHERE, not each word.
const ROLLUP = new Set(['comment-cover', 'keyword-cover'])

// findings -> ordered groups the runner and the CLI both print:
//   { kind, count, note, rollup: [{file, count, lines}] } or
//   { kind, count, note, detail: [{text, positions}] } (grouped by answer) or
//   { kind, count, note, byLine: [{file, line, words: [{word, ch}], src}] }
// The last is the census's: its rows have no answer to group under. Each
// position prints as its own `file:line:col` row — the shape a terminal
// links — and the source line once per line, so a reader sees which of
// its words went quiet in the context needed to judge the silence.
export function organize(findings) {
  const groups = []
  for (const kind of ORDER) {
    const rows = findings.filter((f) => kindOf(f) === kind)
    if (rows.length === 0) continue
    const g = { kind, count: rows.length, note: KIND_NOTES[kind] }
    if (kind === 'silent-name') {
      const byLine = new Map()
      for (const f of rows) {
        const k = `${f.file}\0${f.line}`
        const e = byLine.get(k) ?? { file: f.file, line: f.line, words: [], src: f.src }
        e.words.push({ word: f.word, ch: f.ch })
        byLine.set(k, e)
      }
      g.byLine = [...byLine.values()]
    } else if (ROLLUP.has(kind)) {
      const byFile = new Map()
      for (const f of rows) {
        const e = byFile.get(f.file) ?? { file: f.file, count: 0, lines: new Set() }
        e.count++; e.lines.add(f.line + 1)
        byFile.set(f.file, e)
      }
      g.rollup = [...byFile.values()].map((e) => ({ ...e, lines: [...e.lines].sort((a, b) => a - b) }))
    } else {
      const byText = new Map()
      for (const f of rows) {
        const e = byText.get(f.text) ?? { text: f.text, positions: [] }
        e.positions.push(f)
        byText.set(f.text, e)
      }
      g.detail = [...byText.values()]
    }
    groups.push(g)
  }
  return groups
}
// The classes the audit contract GATES (sweep.machinery): the
// machinery-decline doctrine's hard violations. The rest are gauges
// until the decline work drains them.
export const GATED = new Set(['minted', 'scaffold', 'cover-this', 'cell', 'minted-in-diagnostic'])
export const kindOf = (f) => f.kind.split(':')[0]

if (import.meta.main) {
  const explicit = process.argv.slice(2)
  const sets = explicit.length > 0 ? [{ name: 'files', root: repoRoot, files: explicit }] : defaultSets()
  for (const set of sets) {
    const { probes, answered, findings } = await sweep(set.root, set.files)
    console.log(`\n══ ${set.name} ─ ${set.files.length} files · ${probes} probes · ${answered} answered · ${findings.length} findings`)
    for (const g of organize(findings)) {
      console.log(`\n  ${g.kind} (${g.count})`)
      console.log(`    ${g.note}`)
      if (g.rollup) {
        for (const e of g.rollup) console.log(`    ${e.file} · ${e.count} row${e.count === 1 ? '' : 's'} · lines ${e.lines.join(', ')}`)
      } else if (g.byLine) {
        const loc = (e, w) => `${path.basename(e.file)}:${e.line + 1}:${w.ch + 1}`
        const locW = Math.max(...g.byLine.flatMap((e) => e.words.map((w) => loc(e, w).length)))
        const wordW = Math.max(...g.byLine.flatMap((e) => e.words.map((w) => w.word.length)))
        for (const e of g.byLine) {
          e.words.forEach((w, i) => console.log(`    ${loc(e, w).padEnd(locW)}  ${w.word.padEnd(wordW)}  │ ${i === 0 ? e.src : ''}`))
        }
      } else {
        for (const e of g.detail) {
          console.log(`    ${e.text.slice(0, 100)}`)
          for (const f of e.positions) console.log(`      ${f.file}:${f.line + 1}:${f.ch + 1} '${f.word}'`)
        }
      }
    }
  }
  process.exit(0)
}
