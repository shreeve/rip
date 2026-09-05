# rip/pdf — build plan

> **Tiny, zero-dependency PDF writer for one-to-few-page business documents — text, rules, boxes, tables, barcodes, images, embedded TrueType; browser-safe.**

This is the working plan for building `packages/pdf`. It is opened while
shipping and deleted (or folded into README.md) when the package lands.

**Status (2026-09-04):** phases 0–7 are built and green — `pdf.rip`,
`test.rip` (39 cases), `demo.rip`, `fonts/`, `README.md`. The demo
reproduces the reference requisition with every text line within 1.5 pt
of the Chrome render, at 42 KB in ~4 ms. Deviations from the plan as
written are noted inline below; phase 8 (version `4.0.0`, removing this
file) and phase 9 (optional extras) remain.
It descends from `misc/updraft/updraft.rb` (2010) and from a four-part
study done on 2026-09-04: a line-by-line audit of Updraft executed under
Ruby 2.6, a survey of the 2026 PDF landscape with live measurements in
Bun, a reverse-engineering of `medlabs/tools/requisition` and its rendered
output, and an API design pass whose every construct was verified by
compiling scratch `.rip` files under rip 4.0.0.

---

## 1. Why this exists

- **Updraft's architecture is right and its implementation is dead.** The
  append-only buffer with offsets captured at object start, lazy emission
  of color and font operators, unit-scaled top-left coordinates, and
  block-scoped state are exactly what a minimal writer should do. But the
  Ruby no longer loads (`iconv`), every PNG is rejected under UTF-8 source
  encoding, xref offsets are character counts, and page text is
  transcoded to Latin-1 instead of WinAnsi so `—` `•` `“` `€` all raise.
- **Nothing in JS land is both tiny and dependency-free.** pdf-lib is
  177 KB gzipped plus a 4 MB fontkit for custom fonts and is unmaintained;
  pdfkit carries 16 transitive deps; headless Chromium is 170–282 MB.
- **The requisition's 240 KB is a Chrome artifact.** Skia emits Type 3
  outlines for variable fonts, and Inter/JetBrains Mono ship as variable
  WOFF2. Static WinAnsi subsets are ~10 KB / ~8 KB per weight after Flate.
  A direct writer yields the page in 30–40 KB with searchable text, or
  1–3 KB on core-14, in single-digit milliseconds instead of the measured
  1.2 s, with no Chrome, no ephemeral HTTP server, no leaked profile
  directories.

Two runtime facts settle the design, both verified here on Bun 1.4:

1. `Bun.deflateSync` emits **raw** deflate regardless of options
   (bun#6401); `/FlateDecode` needs zlib-wrapped and poppler rejects the
   raw form. `CompressionStream.new 'deflate'` emits zlib (`78 9c`) in Bun
   and in every Baseline-2023 browser. So `bytes` is async and the package
   stays browser-safe.
2. Static `.ttf` is the only embeddable form. WOFF2 (Brotli + transformed
   glyf) and variable fonts are out. Both Inter 4.1 and JetBrains Mono
   2.304 release zips ship static TTFs under the OFL.

---

## 2. Decisions (settled)

| Decision | Choice |
|---|---|
| Configuration | Named options are the canonical form. **Updraft's polymorphic positional args are kept as sugar**: `PDF.new 'letter', 'landscape', 'in', 'helvetica', 12, margins: 36`. Every positional arg is classified by shape; an unrecognized string or number rejects loudly, naming the arg. Classification happens before any scaling so order never matters (Updraft's `('pt', {top: 1})` vs `({top: 1}, 'pt')` trap is designed out). |
| Units | `unit: 'pt'` default; `'in' 'mm' 'cm'` accepted. Every number in and out of the API is in `unit`; internals are points. Font sizes are always pt. |
| Origin | Top-left, y grows downward. One flip at emission (`H - y`). |
| Text `y` | Top of the line box; baseline = `y + ascent·size`. Box and table layouts compute from the top. |
| Negative coordinate = from far edge | Dropped. `doc.box.right - w` and `align: 'right'` cover the real uses; `-0` had no honest meaning. |
| Positioned text and the cursor | **`text` with explicit `x`/`y` moves the cursor to the end of the run** (Updraft behavior), so `text 'A', x: 1, y: 1; text 'B'` chains. Pass **`move: false`** to leave the cursor where it was. |
| Margins | **Mutable mid-document.** `doc.margins 36` / `[tb, lr]` / `[t, r, b, l]` recomputes `doc.box` for everything placed afterwards and never touches anything already drawn. A cursor sitting at the old left edge follows the new one; a positioned cursor stays put. The default margin is 36 pt expressed in the document unit. This is Updraft's own model (`indent` moved the left margin) and is not absurd: flow ops (`puts`, `paragraph`, `down`, `rule`, `table` without `x`/`w`) read the box at call time; positioned ops ignore margins entirely. `page!` keeps the current margins. |
| Scoped state | `doc.scope state, ->`, `doc.at x, y, ->`, `doc.indent dx, ->`. Rip has no `instance_eval`; the trailing lambda is the idiom (`test "x", ->`). Per-call style keys cover the 90% case so blocks are rare. (`with` is a reserved word in Rip, hence `scope`.) |
| Bounded text overflow | Default `overflow: 'error'`; opt-in `'ellipsis'`. A silently clipped patient name on a lab form is the worst failure class. |
| Non-WinAnsi character | Throw, naming the character and code point. No `?` substitution. `PDF.winAnsi str` lets app code validate at intake. |
| Fonts | Core-14 minus Symbol/ZapfDingbats, plus simple-font TrueType with WinAnsi encoding. One measurement, escaping and wrapping path for both. CID/Identity-H only buys non-Latin text; out of scope. |
| Subsetting | None at runtime in v1. Pre-subset static TTFs are demo assets (§9). Runtime subsetting is phase 9 if ever. |
| Compression | Always `CompressionStream`; `compress: false` still returns a Promise. One shape. |
| Determinism | No `/CreationDate`, no `/ID` unless `date:` is given. Two builds of the same document are byte-identical (pinned). |
| Output | `doc.bytes!` → `Uint8Array`. File I/O lives in the caller; `pdf.rip` contains no `Bun.*`, `process`, `globalThis`, or imports, so `rip.browser: true` is honest and pinned. |
| CLI | None. There is no sensible input format, and a `bin` would need `Bun.write`. |
| Demo | The lab requisition, built from the same `SAMPLE` object the HTML template uses, is `demo.rip`. Production use in medlabs imports `rip/pdf`. |
| Test field name | Test rows use `tat`. (medlabs `payload.json` was corrected from `turnaround` on 2026-09-04.) |

---

## 3. Rip idioms this package must use

The CI test `test/toolchain/package-rip-style.test.js` parses every
`packages/**/*.rip` and fails on: a prefix `new`; a written `await` whose
operand is call-shaped; and `f!()` (redundant empty parens on a dammit).
Beyond what CI enforces, the package follows AGENTS.md "Style" and the
dialect of `src/grammar/solar.rip`, `packages/csv/csv.rip`,
`packages/decimal/decimal.rip`, and `packages/http/http.rip`. Verified by
compilation on 2026-09-04:

| Form | Spelling | Compiles to |
|---|---|---|
| Construction | `Uint8Array.new n`, `Error.new "msg"`, `CompressionStream.new 'deflate'` | `new Uint8Array(n)` … |
| Construction + await | `X.new! args` | `await new X(args)` |
| Call + await (dammit) | `w.write! bytes`, `w.close!`, `doc.bytes!`, `Response.new(cs.readable).arrayBuffer!` | `await w.write(bytes)` … |
| Await a stored promise | `await p` (only for a value already in hand, never `await f()`) | `await p` |
| Void function | `def emit!(op)` / `flush! = ->` / class method `page!: ->` | function with no implicit return |
| Constant | `KAPPA =! 0.5523`, `PAPERS =! {...}` | `const` |
| Loud rejection | `throw PDFError.new "pdf: unknown option #{JSON.stringify k}"` | |
| Iteration | `for own k, v of opts`, `for [a, b], i in rows`, `for x in list when x?`, `for i in [0...n]` | |
| Conditionals | `unless`, postfix `if`/`unless`/`while`, `switch … when 'a', 'b' then …`, `try … catch then fallback` | |
| Existence | `x?`, `x ?= y`, `a ?? b`, `f? x` (optional call) | |
| Chainable setters | `font: (key, size) -> …; this` | |
| Class shape | `export class PDF` with `constructor: (...args) ->`, `@static: ->`, `name: (a) ->`, `name!: ->` | |

A void method is **defined** with the bang (`page!: ->`) and **called**
plainly (`doc.page()`); the call-site bang is always dammit (`doc.bytes!`
awaits). Do not confuse the two. Which methods are void: `page!`,
`rect!`, `line!`, `rule!`, `circle!`, `register!`, `scope!`, `at!`,
`indent!` (`margins` is chainable and returns `this`). Methods that
return a value are plain: `text` (drawn width), `paragraph` (height),
`table` (height), `image` and `barcode` (`{w, h}`), `width`, `lines`,
`bytes`.

Reserved words met while building: `with` (reserved), `off`/`on`/`yes`/`no`
(value words) — none can be a method or variable name. Class members have
no `get`/`set` form, so `x`, `y`, `box` are plain fields in the document
unit. Static class fields are `@name = value`. A binary `a ? b` is not a
null default; that is `a ?? b`.

Scoping gotcha found while prototyping: Rip has CoffeeScript scoping, so
an assignment inside an inner function to a name also assigned in an
enclosing scope writes the outer binding. Module-level helpers take
parameters and use distinct names; inside the class use `@`.

---

## 4. Package layout (default mold, `packages/AGENTS.md`)

```
packages/pdf/
  pdf.rip        # library entry; no shebang; no Bun.*; no imports
  demo.rip       # the requisition → requisition.pdf via Bun.file / Bun.write
  test.rip       # rip/testing suite; pdfinfo/pdftotext oracle, skipped loudly when absent
  fonts/         # demo assets: pre-subset static TTFs + OFL.txt (data, not modules)
  package.json
  README.md
  PLAN.md        # this file; removed when the package lands
```

`package.json` (key order per the mold):

```json
{
  "name": "@rip/pdf",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Tiny, zero-dependency PDF writer for one-to-few-page business documents — text, rules, boxes, tables, barcodes, images, embedded TrueType; browser-safe.",
  "exports": { ".": "./pdf.rip" },
  "scripts": { "test": "rip test.rip", "demo": "rip demo.rip" },
  "rip": { "browser": true },
  "files": ["pdf.rip", "README.md"]
}
```

Version stays `0.0.0` until the surface stabilizes, then `4.0.0`.

---

## 5. Public API

```coffee
import { PDF, PDFError } from 'rip/pdf'

# ==[ Construction ]==  named options are canonical; positional sugar accepted
doc = PDF.new
  paper:    'letter'      # 'letter'|'legal'|'a3'|'a4'|'a5'|[w, h] in unit
  layout:   'portrait'    # |'landscape'
  unit:     'pt'          # 'pt'|'in'|'mm'|'cm'
  margins:  36            # n | [tb, lr] | [t, r, b, l] in unit
  font:     'helvetica'   # initial font key
  size:     12            # pt
  leading:  1.2           # line height = size × leading
  compress: true
  breaks:   true          # flow ops auto page-break
  header:   null          # (doc, n) ->          top of every page, incl. the first
  footer:   null          # (doc, n, total) ->   runs at finalize, so total is known
  title: null, author: null, subject: null, keywords: null, creator: null
  date:     null          # Date → /CreationDate; null → omitted
  fonts:    null          # { key: bytes } registered before page 1, so the header hook can use them

doc = PDF.new 'a4', 'landscape', 'mm', 'times', 11, margins: 20   # same thing, Updraft style
# positional classification: paper name | 'portrait'/'landscape' | unit | core font key |
# number = size | [w, h] = paper | true/false = compress | trailing object = options

PDF.version                 # a literal kept in step with package.json (test.rip pins both)
PDF.fonts                   # ['helvetica','helveticaB','helveticaI','helveticaBI','times',…,'courierBI']
PDF.papers                  # ['letter','legal','a3','a4','a5']
PDF.winAnsi str             # true when every char is encodable

# ==[ Geometry (unit) ]==
doc.paper                   # {w, h}
doc.box                     # {left, top, right, bottom, width, height} — inside current margins
doc.x, doc.y                # cursor; assignable
doc.pageNumber; doc.pageCount

# ==[ Pages and margins ]==
doc.page()                  # new page; cursor → box top-left; runs header hook   (void: page!)
doc.margins n | [tb, lr] | [t, r, b, l]   # recompute box for later placement; returns doc

# ==[ Cursor ]==
doc.goto x, y               # either may be null; returns doc
doc.move dx, dy             # relative; returns doc
doc.down n = 1              # n lines of leading; x → indent left; auto-breaks; returns doc

# ==[ State ]==  setters return doc; every draw op accepts the same keys inline
doc.font key, size?         # throws on unregistered key
doc.size pt
doc.color c                 # text fill      (Updraft fontcolor)
doc.stroke c                # line color     (Updraft drawcolor)
doc.fill c                  # area color     (Updraft fillcolor)
doc.lineWidth w             # (Updraft thick)
doc.leading mult
doc.tracking pt             # letter-spacing → Tc
doc.scope state, ->         # snapshot ALL state + cursor + margins, run, restore (even on throw)
doc.at x, y, ->             # = scope {x, y}
doc.indent dx, ->           # shift box.left by dx for the block; nests

# colors: '#rrggbb' | '#rgb' | [r, g, b] 0–255 | number 0..1 gray | 'black' | 'white'; else throw

# ==[ Text ]==
doc.width str, {font, size, tracking}                # pure; unit
doc.lines str, w, {font, size, tracking}             # pure; word-wrapped; overlong words split by char
doc.text str, {x, y, w, align, overflow, move, font, size, color, tracking, upper}
  # one line; x/y default to the cursor; w bounds it (required for align center/right);
  # overflow 'error' | 'ellipsis'; move: false leaves the cursor; returns drawn width
doc.puts str, opts          # text at cursor then newline; auto-breaks
doc.paragraph str, {x, y, w, align, font, size, color, leading}   # wraps; returns height; auto-breaks per line

# ==[ Shapes ]==  fill/stroke: color | true (current) | absent; neither → stroke with current
doc.rect x, y, w, h, {fill, stroke, width, radius, dash}
doc.line x1, y1, x2, y2, {stroke, width, dash}
doc.rule {y, x1, x2, stroke, width}                  # horizontal rule across the box
doc.circle cx, cy, r, {fill, stroke, width}

# ==[ Fonts ]==
doc.register key, bytes     # static .ttf as Uint8Array|ArrayBuffer; throws on OTTO/wOFF/wOF2/ttcf

# ==[ Images ]==
doc.image bytes, {x, y, w, h}       # PNG (≤8-bit gray/RGB/palette, no alpha, no interlace) or JPEG;
                                    # give w or h (aspect kept) or both; returns {w, h}; same bytes embed once

# ==[ Barcodes ]==
doc.barcode str, {type, x, y, w, h, module, align, color}
  # 'code128' (default, auto B/C) | 'code39'; `w` or `module` (bar width) sets the size;
  # `align` 'left'|'right'|'center' anchors x; returns {x, y, w, h}

# ==[ Table ]==
doc.table rows, {x, y, w, cols, header, head, rowH, pad, size, font, color, align, stripe, rule, frame, row}
  # rows: string[][]; cols: [{w, align, font, color, size, overflow}], exactly one column may omit w (flex)
  # header: string[] styled by head {h, fill, color, font, size, upper, tracking}
  # stripe: odd-row fill; rule: separator color; frame: outer border color
  # row: (cells, i) -> style | undefined     per-row override ({stripe, font, size, color, tracking})
  # auto-breaks between rows and re-draws the header (never orphaned); a row taller than a page throws;
  # the frame closes at each break and reopens on the next page; returns the summed height

# ==[ Output ]==
bytes = doc.bytes!          # Uint8Array; finalizes (footer hooks); idempotent; drawing after → throws
```

### Updraft name map

| Updraft | rip/pdf |
|---|---|
| `Updraft.new('letter','in',12){…}` | `PDF.new 'letter', 'in', 12` (block form gone; positional sugar kept) |
| `page` | `page()`; first page is implicit |
| `goto/move/down` | same |
| `where`, `x()`, `y()` | `doc.x`, `doc.y` |
| `from(x,y){}` | `at x, y, ->` (`from` collides visually with `import … from`) |
| `font('B'){}` block | `scope font: 'helveticaB', ->` |
| `indent{}`/`undent` | `indent dx, ->`; undent implicit |
| `margins(...)` | `margins ...` (same semantics, still mutable) |
| `colors/drawcolor/fillcolor/fontcolor/linecolor/textcolor` | `stroke/fill/color` |
| `thick` | `lineWidth` |
| `fill(x,y,w,h)/draw(x,y,w,h)` | `rect …, fill:/stroke:` |
| `line(*args)` 0–4 arities | `line x1,y1,x2,y2` + `rule` |
| `print/puts/text` | `text/puts` |
| `wrap/lines` | `paragraph/lines` |
| `center/right` | `align:` |
| `text(x,y,str,eols,wide)` ellipsis | `text str, w:, overflow: 'ellipsis'` |
| `table(y, cols, rows)` | `table rows, opts` |
| `bold{}` | inline `font:` |
| `size/spacing/height` | `size/leading` |
| `image(path,…)` | `image bytes, …` |
| `barcode_39` | `barcode str, type: 'code39'` |
| `finish/save/to_s` | `bytes!`; saving is the caller's `Bun.write` |
| `zoom/layout` viewer prefs, `author=` accessors | dropped / constructor metadata |

---

## 6. Internal design of `pdf.rip`

Sections in the `# ==[ … ]==` style of `csv.rip`, in this order. Line
budgets are estimates from the prototype; the total target is ~1,200.

### 6.1 Constants (~95)

```coffee
PAPERS =!
  letter: [612, 792], legal: [612, 1008]
  a3: [841.89, 1190.55], a4: [595.28, 841.89], a5: [420.94, 595.28]
UNITS  =! { pt: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54 }
KAPPA  =! 0.5523                      # Bézier quarter-circle
CORE   =!                             # key → [BaseFont, widths table]
  helvetica: ['Helvetica', 'helvetica'],  helveticaB: ['Helvetica-Bold', 'helveticaB']
  helveticaI: ['Helvetica-Oblique', 'helvetica'], helveticaBI: ['Helvetica-BoldOblique', 'helveticaB']
  times: ['Times-Roman', 'times'], timesB: ['Times-Bold', 'timesB']
  timesI: ['Times-Italic', 'timesI'], timesBI: ['Times-BoldItalic', 'timesBI']
  courier: ['Courier', 'courier'], courierB: ['Courier-Bold', 'courier']
  courierI: ['Courier-Oblique', 'courier'], courierBI: ['Courier-BoldOblique', 'courier']
CP1252 =! { 0x20AC: 0x80, 0x201A: 0x82, … 0x0178: 0x9F }   # 27 entries, appendix A
CODE128 =! '212222 222122 … 2331112'.split ' '              # 107 patterns, appendix B
CODE39  =! { '0': 'bWBwbwBwb', … }                           # 44 patterns from Updraft
```

### 6.2 Width tables (~50)

Six tables (Helvetica, Helvetica-Bold, Times ×4) as base-36 pairs for
codes 32–255 (224 entries; max width 1042 < 1296). Helvetica obliques
alias their uprights (verified identical in Updraft's data); Courier is
`Array(224).fill 600`. Decoded lazily and memoized:

```coffee
WIDTHS =! { helvetica: '7q7q9vfg…', helveticaB: '…', times: '…', timesB: '…', timesI: '…', timesBI: '…' }
decoded = {}
widthsFor = (key) ->
  decoded[key] ?= if key is 'courier' then Array(224).fill(600)
  else (parseInt(WIDTHS[key].substr(i * 2, 2), 36) for i in [0...224])
```

Strings are in appendix C, already verified: Helvetica space 278, `a`
556, `A` 667, `W` 944, `·` 278, `—` 1000; Times `a` 444; Times-Bold `a`
500 (33 further Helvetica entries matched the Adobe AFM).

### 6.3 Bytes (~45)

```coffee
export class PDFError extends Error
  constructor: (message) ->
    super message
    @name = @constructor.name

winAnsi = (str) ->                    # JS string → cp1252 bytes; loud on anything else
  out = Uint8Array.new str.length
  for i in [0...str.length]
    c = str.charCodeAt i
    b = if c < 0x80 or (c >= 0xA0 and c <= 0xFF) then c else CP1252[c]
    throw PDFError.new "pdf: #{JSON.stringify str[i]} (U+#{c.toString(16).toUpperCase().padStart 4, '0'}) is not in WinAnsi" unless b?
    out[i] = b
  out

pdfString = (str) -> "(#{str.replace /[\\()]/g, '\\$&'})"   # applied to the JS string; bytes via winAnsi
n3 = (x) -> String(Math.round(x * 1000) / 1000)              # operand formatting, no trailing zeros

def deflate(bytes)
  cs = CompressionStream.new 'deflate'
  w  = cs.writable.getWriter()
  w.write! bytes
  w.close!
  Uint8Array.new Response.new(cs.readable).arrayBuffer!
```

`deflate` is auto-async because of the dammits inside it. Nothing else in
the file is async except `bytes`.

### 6.4 Color (~30)

`parseColor c` → `{gray: g}` or `{rgb: [r, g, b]}` in 0..1, or throw.
Emission picks `g`/`G` or `rg`/`RG`. Strings compared for the lazy cache
are the formatted operand strings (`'0.5 g'`), so equal colors written
in different notations still dedupe.

### 6.5 Fonts (~130)

Core font record: `{key, kind: 'core', base, widths, ascent: 0.75,
descent: 0.22, capHeight: 0.7}` (Helvetica/Times/Courier AFM ascenders
scaled; good enough for line boxes).

TrueType parser, static `.ttf` only:

- Signature `0x00010000` or `'true'`; reject `OTTO` (CFF → would need
  `/FontFile3`), `wOFF`, `wOF2`, `ttcf` with the exact name of what was
  found.
- Table directory → `head` (unitsPerEm, bbox, indexToLocFormat), `hhea`
  (ascender, descender, numberOfHMetrics), `hmtx`, `maxp` (numGlyphs),
  `cmap` (3,1) format 4 and (3,10) format 12, `OS/2` (capHeight,
  xHeight, weightClass, fsSelection), `post` (italicAngle, isFixedPitch).
- Build `widths[224]` by mapping each WinAnsi code → Unicode (reverse of
  `CP1252` + Latin-1 identity) → glyph id → advance × 1000 / unitsPerEm.
  A missing glyph gets width 0 and is recorded in `missing`; `measure`
  throws when text uses one (fonts legitimately lack `¤ ¦ ¬`, so
  registration itself stays quiet).
- Descriptor: `Flags` = 32 (Nonsymbolic) | 1 if fixed pitch | 64 if
  italic; `FontBBox`, `ItalicAngle`, `Ascent`, `Descent`, `CapHeight`,
  `StemV` (80; required key, value ignored by viewers).
- Emitted as four objects: Font (`/Subtype /TrueType /BaseFont /XXXXXX+Name
  /FirstChar 32 /LastChar 255 /Widths /Encoding /WinAnsiEncoding
  /FontDescriptor`), FontDescriptor (`/FontFile2`), Widths array,
  FontFile2 stream (Flate, `/Length1` = raw byte length). The `XXXXXX+`
  subset tag is emitted only for pre-subset files (phase 9 will emit it
  for runtime subsets); v1 uses the bare name.

### 6.6 Measure and wrap (~55)

```coffee
measure = (str, font, size, tracking) ->      # points
  n = 0
  for i in [0...str.length]
    b = winAnsiByte str, i                    # throws on non-WinAnsi
    n += font.widths[b - 32]
  n * size / 1000 + tracking * str.length     # Tc applies after EVERY glyph, incl. the last
```

`wrapLines str, w, …` splits on `\n` first, then greedy word fill on
spaces; a word wider than `w` is split at the widest character prefix
that fits so text is never lost. Trailing blank lines are preserved
(Updraft's `split` dropped them; `center` and `right` did not — pick
"preserve" and pin it).

### 6.7 Images (~90)

`sniff bytes` by magic: `89 50 4E 47` → PNG, `FF D8` → JPEG, else throw.
PNG: chunk walker; IHDR → w, h, bit depth, color type; reject alpha
types 4/6, 16-bit, interlace, each with its own message; PLTE → palette
stream; IDAT concatenated and passed through untouched with
`/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors c
/BitsPerComponent d /Columns w >>`; tRNS on indexed → `/Mask [i i]`.
JPEG: marker walk to SOF0/1/2 → precision, h, w, components; 1/3/4 →
Gray/RGB/CMYK; `/Decode [1 0 1 0 1 0 1 0]` when an Adobe APP14 marker is
present with CMYK; stream is the whole file with `/DCTDecode`.

### 6.8 Barcodes (~75)

Code 128 auto B/C with checksum `(start + Σ value_i·i) mod 103`, stop
106; verified vectors: `'Wikipedia'` → check 88; `'L2602852147'` →
`[104,44,99,26,2,85,21,47,76,106]`. Code 39 from Updraft's table with
2.5:1 wide/narrow and one narrow gap. Both return `{modules}` (an array
of bar/space widths in modules); drawing is a run of `re f` in the
current fill color, scaled so the total equals `w` (module = `w / total`)
or, when `w` is absent, module = 1 pt.

### 6.9 `class PDF` (~70 constructor, ~110 state, ~110 text, ~70 shapes, ~120 register/image/barcode/table, ~130 emit)

```coffee
export class PDF
  constructor: (...args) ->
    opts = parseArgs args                 # positional sugar + trailing object → validated options
    @unit    = UNITS[opts.unit]
    [w, h]   = paperSize opts.paper, @unit
    [w, h]   = [h, w] if opts.layout is 'landscape'
    @paperPt = {w, h}
    @fonts   = {}                         # key → font record; core fonts added lazily on first use
    @images  = []                         # {bytes, info, index}
    @pages   = []                         # {ops: [], used: {font, color, stroke, width, tracking}}
    @state   = {font: opts.font, size: opts.size, color: '0 g', stroke: '0 G', fill: '0 g', lineWidth: 1, leading: opts.leading, tracking: 0}
    @hooks   = {header: opts.header, footer: opts.footer}
    @meta    = pick opts, ['title', 'author', 'subject', 'keywords', 'creator', 'date']
    @breaks  = opts.breaks
    @compress = opts.compress
    @finished = false
    @margins opts.margins
    @page()

  page!: ->
    throw PDFError.new 'pdf: document is finished' if @finished
    @pages.push {ops: [], used: {}}
    @pageNumber = @pages.length
    @x = @box.left; @y = @box.top
    @hooks.header? this, @pageNumber
```

Lazy content state, Updraft's `line/area` trick generalized: every op
calls `@useFont`, `@useColor kind`, `@useLineWidth`, `@useTracking`, each
of which compares against `page.used` and pushes the operator only on
change. `page.used` starts empty on every page because a new content
stream begins in the default graphics state.

`scope!`: snapshot `{...@state, x, y, margins}`, apply the overrides, run
`fn`, restore in `finally`.

Text emission: `BT /F#{i} #{size} Tf #{Tc} Tc #{x} #{H - baseline} Td (…) Tj ET`
with the string bytes passed through `winAnsi`; ops are stored as
`Uint8Array` chunks (never JS strings) so the page stream is byte-exact.

Emit order in `bytes`: run footer hooks per page (temporarily reopening
that page's op list, with `total` known); then Catalog 1, Pages 2, Info 3,
per page {Page (with its own MediaBox and Resources — never inherited,
for the sake of printer firmware), Contents}, per font {Font, FontDescriptor,
Widths, FontFile2}, per image {XObject, palette?}, one shared Resources object; xref
table (`padStart 10, '0'`, 20-byte entries); trailer; `%%EOF`. Object
numbers are assigned by a counter at emit time and references are
written from a table — never computed by arithmetic (Updraft's
`/Resources` offset formula was correct but fragile).

```coffee
  bytes: ->
    return @out if @out?
    @finalize()
    w = Writer.new                        # chunks[], offsets[], pos; obj n, dict, stream?
    …
    for page in @pages
      stream = concat page.ops
      stream = deflate! stream if @compress
      w.obj n, "<< /Length #{stream.length}#{if @compress then ' /Filter /FlateDecode' else ''} >>", stream
    …
    @finished = true
    @out = w.finish()
```

`Writer.obj` records `offsets[n] = pos` **before** writing `"#{n} 0 obj\n"`,
and `pos` counts bytes of encoded chunks, never string lengths. The
header is `%PDF-1.4\n%\xE2\xE3\xCF\xD3\n` written as bytes.

### 6.10 Table (~part of the 120)

Column x-positions from `cols[].w` with exactly one flex column taking
the remainder; header row via `head`; each body row: optional stripe
fill, cell texts with per-column font/color/align/overflow (default
`'error'`), separator rule; frame last so it sits on top. Page break
between rows when `@breaks` and the next row would cross `box.bottom`:
`@page()`, redraw header, continue. Returns the drawn height.

---

## 7. Phases and acceptance criteria

Each phase lands with its tests in the same commit (AGENTS.md rule 6).
Run with `bun run test` from `packages/pdf`. No phase is done until
`pdfinfo` and `pdftotext` (poppler, present on this Mac at
`/opt/homebrew/bin`) accept the output and every xref offset lands on
its object.

### Phase 0 — scaffold
- `package.json`, `README.md` (top LAF only), `pdf.rip` exporting `PDF`
  and `PDFError`, `test.rip` with the surface section.
- Acceptance: `bun run test` passes the surface pins; the repo's
  `package-rip-style` and `dependencies` toolchain tests stay green.

### Phase 1 — object writer + core-14 text
- Constants, width tables, bytes, color, core fonts, `PDF` constructor
  (named + positional), `page!`, `margins`, cursor, state, `text`,
  `puts`, `width`, `bytes!`.
- Acceptance: a Letter page with Helvetica and Times text, `—` and `·`,
  builds to < 1.5 KB; `pdftotext` round-trips
  `'Hello, PDF — ·middot· (parens) \ back'`; two builds are
  byte-identical; every xref offset lands on `N 0 obj`; `/Length` equals
  each stream's byte count; unknown option, bad color, bad paper, bad
  unit, `font 'symbol'`, non-WinAnsi char all throw with the pinned
  messages; positional sugar in any order produces the same options.

### Phase 2 — shapes, wrap, flow, scoped state
- `rect` (with `radius`, `dash`), `line`, `rule`, `circle`, `lineWidth`,
  `paragraph`, `lines`, `down`, `with`, `at`, `indent`, `header`/`footer`
  hooks, auto page-break, `align`, `overflow: 'ellipsis'`, `tracking`,
  `upper`, `move: false`.
- Acceptance: pinned break points for a known Helvetica paragraph;
  overlong word splits by char; `down` at the bottom triggers `page()`
  and the header hook with `n = 2`; `footer` receives `total`; `with`
  restores state after a throw; `margins` mid-document changes `box`
  for later `puts` and not earlier output (pin by comparing content
  streams); a tracked right-aligned string ends exactly at `w` (`n·t`
  measurement pinned).

### Phase 3 — TrueType
- `register!`, parser, four-object emission, `Flags`, missing-glyph
  reporting.
- Acceptance: a vendored static TTF registers with the expected
  ascent/descent/capHeight/flags; widths agree with `hmtx`; `/Length1`
  equals the byte length; `pdftotext` extracts text set in it; `wOF2`,
  `OTTO`, `ttcf` reject by name; a document with Inter text is < 40 KB
  with three weights.

### Phase 4 — images
- PNG and JPEG passthrough.
- Acceptance: hand-built 1×1 RGB PNG and minimal SOF0 JPEG parse to the
  right dimensions; XObject dicts pin `/Width /Height /ColorSpace
  /BitsPerComponent /Filter`; alpha/interlace/16-bit PNGs reject by
  name; the same `Uint8Array` used twice embeds once; `pdfimages -list`
  shows one image per unique input.

### Phase 5 — barcodes
- Code 128 and Code 39.
- Acceptance: the two published Code 128 vectors above; modules =
  11·n + 13; Code 39 `'*A*'` pattern equals Updraft's table; lowercase
  in Code 39 throws; a rendered barcode's bar bboxes (via
  `pdftotext -bbox` is text-only, so parse the content stream) sum to `w`.

### Phase 6 — table
- `table` with header, stripes, rules, frame, per-row style, page
  breaks with header redraw.
- Acceptance: a 40-row table across two pages redraws the header on
  page 2 and `pdftotext` shows rows in order with `\f` between pages;
  two flex columns throw; an over-wide cell throws naming row and
  column unless that column has `overflow: 'ellipsis'`.

### Phase 7 — the requisition demo
- `demo.rip` with the `SAMPLE` object from `requisition.html`, the five
  font assets, and `Bun.write`.
- Acceptance: one page; `pdftotext` contains the requisition number,
  `TESTS ORDERED`, every test name, both signature labels; key
  coordinates match the Chrome reference within 1 pt (§10); output
  < 45 KB; `time rip demo.rip` < 100 ms.

### Phase 8 — README, version bump, PLAN.md removal
- README per the mold: logo, pitch, one paragraph on how it works,
  `**Runtime:** browser-safe (\`rip.browser: true\`). One \`.rip\` file.`,
  Quick Start, Features, Fonts, Images, Barcodes, Tables, Demo, Test.
  Every example run before it is written down.
- `version` → `4.0.0`; delete `PLAN.md`; add the package to
  `packages/AGENTS.md` only if it earns a non-mold shape (it should not).

### Phase 9 — optional, later
- Runtime TrueType subsetting (glyf/loca/hmtx/cmap rewrite, composite
  closure; ~300–400 lines; saves ~6 KB per weight over pre-subset).
- PNG alpha → `/SMask` via `DecompressionStream` (~40 lines; async).
- ExtGState alpha (`/ca`), links (`/Annots` URI), outlines.

---

## 8. Test plan (`test.rip`)

```coffee
import { test, eq, ok, throws } from 'rip/testing'
import { PDF, PDFError } from 'rip/pdf'
import * as mod from 'rip/pdf'
import { readFileSync } from 'fs'

# ==[ Package surface ]==
test "exports", -> eq Object.keys(mod).sort(), ['PDF', 'PDFError']
test "declares browser safety and earns it", ->
  pkg = JSON.parse readFileSync("#{import.meta.dir}/package.json", 'utf8')
  eq pkg.rip, { browser: true }
  source = readFileSync "#{import.meta.dir}/pdf.rip", 'utf8'
  eq /^\s*import\b/m.test(source), false
  eq /\bBun\.|node:|process\.|globalThis/.test(source), false

# ==[ Structure ]==  helpers: latin(bytes) → binary string; xrefOffsets(latin) → [n → offset]
test! "every xref offset lands on its object", ->
  doc = PDF.new()
  doc.text 'hi'
  out = doc.bytes!
  s = latin out
  for [n, o] in xrefOffsets s
    eq s.slice(o, o + "#{n} 0 obj".length), "#{n} 0 obj"

# ==[ Oracle ]==  each prints its own skipped line when the binary is absent
oracle = (bin, args) ->
  r = Bun.spawnSync [bin, ...args]
  if r.exitCode is 0 then r.stdout.toString() else null
```

Sections, in order: surface; loud rejections (every message pinned);
structure (header, binary comment, `startxref` → `xref`, offsets,
`/Size`, `/Length`, determinism, `date:`); oracle (`pdfinfo` pages,
size, landscape, `Title:`; `pdftotext` round-trips and `\f` page
separators); widths; wrap; layout semantics (leading, breaks, hooks,
`with` after throw, `indent` nesting, mutable margins, `move: false`);
Code 128/39 vectors; PNG/JPEG headers; TrueType fixture; the demo smoke.
`test!` for the async cases so output stays ordered.

---

## 9. Font assets

Needed for the demo: Inter Regular/Medium/SemiBold/Bold and JetBrains
Mono Regular/Medium (the six weights Chrome actually used in the
reference PDF). Sources:

- https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip →
  `extras/ttf/Inter-*.ttf` (static instances; `docs/font-files` has only
  WOFF2 and the variable TTF).
- https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip
  → `fonts/ttf/JetBrainsMono-*.ttf`.
- Both OFL-1.1: bundling and redistribution are permitted with the
  license text; check `OFL.txt` in beside them.

Pre-subset once (fontTools in a throwaway venv; it is not installed
globally on this Mac):

```bash
python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools
/tmp/ft/bin/pyftsubset Inter-Regular.ttf --unicodes=U+0020-00FF --no-hinting --layout-features= --drop-tables+=GSUB,GPOS,DSIG --name-IDs= --output-file=fonts/Inter-Regular.ttf
```

Measured result: Inter-Regular 411 KB → 16 KB raw / ~10 KB Flate;
JetBrains Mono → 16 KB / ~8 KB. Done: the six subset TTFs (Inter
Regular/Medium/SemiBold/Bold, JetBrains Mono Regular/Medium, with the full
cp1252 repertoire) and both OFL texts live in `packages/pdf/fonts/`; they
never enter `pdf.rip`. The `--unicodes` list used was U+0020–00FF plus the
27 cp1252 code points from appendix A. `uvx --from fonttools pyftsubset`
is the one-liner when fontTools is not installed.

---

## 10. Requisition demo spec (from the Chrome reference)

Measured from `Lab Order - K.pdf` and fresh renders; Chrome prints at
1 CSS px = 0.75 pt. Coordinates in pt, y-down. Use these for the ≤ 1 pt
regression check in phase 7.

| Element | x | y |
|---|---|---|
| Content box | 28.5–583.5 | 28.5–763.5 |
| Logo mark (28.5 sq, radius 9, brand fill; Inter Bold 13.5 white letter) | 28.5–57 | 31.5–60 |
| Brand name (Inter SemiBold 12) / tagline (Inter 9, `#525252`) baselines | 66.3 | 43.5 / 56.25 |
| Lab name (right edge) / badge box (75×15.75, radius 4.5) | ends 583.2 / 508.5–583.5 | 39 / 46.5–62.25 |
| Requisition strip (fill `#fafafa`, border `#e5e5e5` 0.75, radius 4.5) | 28.5–583.5 | 80.5–151 |
| Strip labels (Inter Medium 6.75 upper, tracking 0.34) / values (JBM Medium 10.5) baselines | 38.5, 163.2, 265.1, 366.9 | 108.75 / 124.5 |
| Barcode (Code 128, module 1.125, 37.5 tall) / caption baseline | 447.75–573.75 | 90–127.5 / 138 |
| Clinic / Provider / Patient cards | 28.5–301.5 / 28.5–301.5 / 310.5–583.5 | 163–248.5 / 258–317 / 163–317 |
| Card heading baselines (Inter SemiBold 7.5 upper, tracking 0.375, dot 3.75 brand) | 46.8 / 328.5 | 179.25, 274.5 |
| Card rows: label x / value x; 13.6 pt pitch | 38.5 / 102.3 and 320.25 / 384 | 195.75 … 290.25 |
| Tests section (border only, radius 4.5) / panel head fill | 28.5–583.5 | 329.5–663 / 329.5–352 |
| Column header bar (`#262626`, Inter SemiBold 7.125 white upper) | 29.25–582.75 | 352.5–372.75 |
| Row 1 / row 12 baselines; column x | 38.5, 104.5, 433, 508 | 387 / 652.5 (pitch 24.125) |
| Row separators (`#ececec`, 0.75) | 29.25–582.75 | 396, 420.75, … 637.5 |
| Stripe on odd test rows (`#fbfbfb` flat) | full inner width | — |
| Clinical strip / text baseline | 28.5–583.5 | 675–696 / 687.75 |
| Signature rules (`#171717`, 0.75) | 28.5–298.5, 313.5–583.5 | 725.25 |
| Signature labels / fine print (Inter 6.75, wraps at 270) | 28.8, 313.5 | 738.75 / 751.5, 760.5 |

Colors: neutral-50 `#fafafa`, 200 `#e5e5e5`, 400 `#a1a1a1`, 600 `#525252`,
800 `#262626`, 900 `#171717`, 950 `#0a0a0a`; border-row `#ececec`; default
brand sky-700 `#0069a8`; red-600 `#e7000b` (overflow band flat `#fde6e7`).
Tenant overrides: `color` (logo, badge, dots), `ink` (header bar, signature
rules, headings), `muted` (all `#525252` text), `panel` (strip fills).

Non-ASCII the template emits: `·` U+00B7 and `—` U+2014 (both WinAnsi);
`⚠` U+26A0 is not in Inter or WinAnsi, and Chrome fell back to the macOS
system font for it. The demo renders the overflow notice without the
glyph.

Dynamic-data policy in the demo: card values and test names use
`overflow: 'ellipsis'`; everything else is bounded by design, so an
overflow throws and the demo reports which field.

---

## 11. Risks

- **Letter-spacing measurement.** `Tc` applies after every glyph
  including the last; `measure` adds `n·t`. If the emitter and the
  measurement disagree, right-aligned tracked headings drift by one `t`.
  Pinned in phase 2.
- **Async surface.** `bytes!` is the only Promise the caller sees.
  README shows it once, first.
- **Table page breaks.** A row taller than the remaining space moves
  whole to the next page; a row taller than a page throws.
- **PNG alpha.** Rejected loudly in v1 ("flatten to RGB or use JPEG").
  Logos with alpha are common; phase 9 adds `/SMask`.
- **Core-14 metrics.** Ascent/descent for line boxes are approximations
  (no AFM bbox shipped). Acceptable for business documents; pin the
  values so they never drift silently.
- **Widths data provenance.** Appendix C was extracted from Updraft's
  tables, which were spot-checked against the Adobe AFMs. Phase 1 pins
  a dozen values so a transcription error surfaces immediately.

---

## Appendix A — CP1252 high half (Unicode → byte)

```
0x20AC:0x80 0x201A:0x82 0x0192:0x83 0x201E:0x84 0x2026:0x85 0x2020:0x86 0x2021:0x87
0x02C6:0x88 0x2030:0x89 0x0160:0x8A 0x2039:0x8B 0x0152:0x8C 0x017D:0x8E 0x2018:0x91
0x2019:0x92 0x201C:0x93 0x201D:0x94 0x2022:0x95 0x2013:0x96 0x2014:0x97 0x02DC:0x98
0x2122:0x99 0x0161:0x9A 0x203A:0x9B 0x0153:0x9C 0x017E:0x9E 0x0178:0x9F
```

Bytes 0x81, 0x8D, 0x8F, 0x90, 0x9D are unassigned; they never appear on
output because no Unicode code point maps to them.

## Appendix B — Code 128 patterns (values 0–106; 106 is Stop with its termination bar)

```
212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212
112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131
311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321
112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121
313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111
314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114
122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212
124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113
114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112
```

Start codes: A 103, B 104, C 105. Verified: `'Wikipedia'` (Start B) →
check digit 88.

## Appendix C — core-14 widths, codes 32–255, base-36 pairs

Decode: `parseInt(s.substr(i * 2, 2), 36)` for `i` in 0…223; index by
`code - 32`. Helvetica obliques share these two tables; Courier is a flat
600.

helvetica:
```
7q7q9vfgfgopij5b9999atg87q997q7qfgfgfgfgfgfgfgfgfgfg7q7qg8g8g8fg
s7ijijk2k2ijgzlmk27qdwijfgn5k2lmijlmk2ijgzk2ijq8ijijgz7q7q7qd1fg
99fgfgdwfgfg7qfgfg6666dw66n5fgfgfgfg99dw7qfgdwk2dwdwdw9a789ag89q
fg9q66fg99rsfgfg99rsij99rs9qgz9q9q666699999qfgrs99rsdw99q89qdwij
7q99fgfgfgfg78fg99khaafgg899kh99b4g8999999fgex7q9999a5fgn6n6n6gz
ijijijijijijrsk2ijijijij7q7q7q7qk2k2lmlmlmlmlmg8lmk2k2k2k2ijijgz
fgfgfgfgfgfgopdwfgfgfgfg7q7q7q7qfgfgfgfgfgfgfgg8gzfgfgfgfgdwfgdw
```

helveticaB:
```
7q99d6fgfgopk26m9999atg87q997q7qfgfgfgfgfgfgfgfgfgfg9999g8g8g8gz
r3k2k2k2k2ijgzlmk27qfgk2gzn5k2lmijlmk2ijgzk2ijq8ijijgz997q99g8fg
99fggzfggzfg99gzgz7q7qfg7qopgzgzgzgzatfg99gzfglmfgfgdwat7satg89q
fg9q7qfgdwrsfgfg99rsij99rs9qgz9q9q7q7qdwdw9qfgrs99rsfg99q89qdwij
7q99fgfgfgfg7sfg99khaafgg899kh99b4g8999999gzfg7q9999a5fgn6n6n6gz
k2k2k2k2k2k2rsk2ijijijij7q7q7q7qk2k2lmlmlmlmlmg8lmk2k2k2k2ijijgz
fgfgfgfgfgfgopfgfgfgfgfg7q7q7q7qgzgzgzgzgzgzgzg8gzgzgzgzgzfggzfg
```

times:
```
6y99bcdwdwn5lm509999dwfo6y996y7qdwdwdwdwdwdwdwdwdwdw7q7qfofofocc
plk2ijijk2gzfgk2k299atk2gzopk2k2fgk2ijfggzk2k2q8k2k2gz997q99d1dw
99ccdwccdwcc99dwdw7q7qdw7qlmdwdwdwdw99at7qdwdwk2dwdwccdc5kdcf19q
dw9q99dwccrsdwdw99rsfg99op9qgz9q9q9999cccc9qdwrs99r8at99k29qcck2
6y99dwdwdwdw5kdw99l47odwfo99l499b4fo8c8c99dwcl6y998c8mdwkukukucc
k2k2k2k2k2k2opijgzgzgzgz99999999k2k2k2k2k2k2k2fok2k2k2k2k2k2fgdw
ccccccccccccijcccccccccc7q7q7q7qdwdwdwdwdwdwdwfodwdwdwdwdwdwdwdw
```

timesB:
```
6y99ffdwdwrsn57q9999dwfu6y996y7qdwdwdwdwdwdwdwdwdwdw9999fufufudw
puk2ijk2k2ijgzlmlmatdwlmijq8k2lmgzlmk2fgijk2k2rsk2k2ij997q99g5dw
99dwfgccfgcc99dwfg7q99fg7qn5fgdwfgfgccat99fgdwk2dwdwccay64ayeg9q
dw9q99dwdwrsdwdw99rsfg99rs9qij9q9q9999dwdw9qdwrs99rsat99k29qcck2
6y99dwdwdwdw64dw99kr8cdwfu99kr99b4fu8c8c99fgf06y998c96dwkukukudw
k2k2k2k2k2k2rsk2ijijijijatatatatk2k2lmlmlmlmlmfulmk2k2k2k2k2gzfg
dwdwdwdwdwdwk2cccccccccc7q7q7q7qdwfgdwdwdwdwdwfudwfgfgfgfgdwfgdw
```

timesI:
```
6y99bodwdwn5lm5y9999dwir6y996y7qdwdwdwdwdwdwdwdwdwdw9999iririrdw
pkgzgzijk2gzgzk2k299ccijfgn5ijk2gzk2gzdwfgk2gzn5gzfgfgat7qatbqdw
99dwdwccdwcc7qdwdw7q7qcc7qk2dwdwdwdwatat7qdwccijccccatb47nb4f19q
dw9q99dwfgopdwdw99rsdw99q89qfg9q9q9999fgfg9qdwop99r8at99ij9qatfg
6yatdwdwdwdw7ndw99l47odwir99l499b4ir8c8c99dwej6y998c8mdwkukukudw
gzgzgzgzgzgzopijgzgzgzgz99999999k2ijk2k2k2k2k2irk2k2k2k2k2fggzdw
dwdwdwdwdwdwijcccccccccc7q7q7q7qdwdwdwdwdwdwdwirdwdwdwdwdwccdwcc
```

timesBI:
```
6yatffdwdwn5lm7q9999dwfu6y996y7qdwdwdwdwdwdwdwdwdwdw9999fufufudw
n4ijijijk2ijijk2lmatdwijgzopk2k2gzk2ijfggzk2ijopijgzgz997q99fudw
99dwdwccdwcc99dwfg7q7qdw7qlmfgdwdwdwatat7qfgccijdwccat9o649ofu9q
dw9q99dwdwrsdwdw99rsfg99q89qgz9q9q9999dwdw9qdwrs99rsat99k29qatgz
6yatdwdwdwdw64dw99kr7edwgu99kr99b4fu8c8c99g0dw6y998c8cdwkukukudw
ijijijijijijq8ijijijijijatatatatk2k2k2k2k2k2k2fuk2k2k2k2k2gzgzdw
dwdwdwdwdwdwk2cccccccccc7q7q7q7qdwfgdwdwdwdwdwfudwfgfgfgfgccdwcc
```

Strip the line breaks before decoding (each table is one 448-character
string).
