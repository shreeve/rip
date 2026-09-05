<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip PDF

> **Tiny, zero-dependency PDF writer for one-to-few-page business documents — text, rules, boxes, tables, barcodes, images, embedded TrueType; browser-safe.**

`rip/pdf` writes the file directly: an append-only object writer with
byte-accurate offsets, a classic xref table, and FlateDecode content
streams. Text is measured from the core-14 width tables or from an embedded
TrueType's `hmtx`, so alignment, wrapping and ellipsis truncation are exact.
Everything a form needs is a method on one document object, coordinates are
top-left in the unit you choose, and anything the writer cannot draw
faithfully — a character outside WinAnsi, a string wider than its box, an
unknown option — throws with a message that names it. The requisition in
`demo.rip` is one 42 KB searchable page; `bun run demo` prints its size and
build time.

**Runtime:** browser-safe (`rip.browser: true`). One `.rip` file; fonts and
images arrive as bytes, the document leaves as a `Uint8Array`, and `bytes`
is async because compression rides `CompressionStream`.

## Quick Start

```coffee
import { PDF } from 'rip/pdf'

doc = PDF.new 'letter', margins: 36, title: 'Invoice 1042'
doc.font 'helveticaB', 18
doc.puts 'Invoice 1042'
doc.font 'helvetica', 10
doc.puts 'Due on receipt — thank you.'
doc.rect 36, 90, 540, 30, fill: '#f4f4f4', stroke: '#ccc', radius: 4
doc.text 'Total', x: 46, y: 99
doc.text '$1,250.00', x: 46, y: 99, w: 520, align: 'right', font: 'helveticaB'
doc.barcode '1042', x: 36, y: 140, h: 30

bytes = doc.bytes!
Bun.write! 'invoice.pdf', bytes
```

## Features

- **Core-14 fonts** with the Adobe AFM widths built in; **TrueType embedding**
  (`register key, bytes`) with WinAnsi encoding, so copy, paste and search
  work in every viewer
- **Text** at a position or at the cursor; `align` left/center/right inside
  a width; `overflow: 'ellipsis'`; `tracking` (letter-spacing); `upper`;
  `paragraph` word-wraps and reports its height; `width` and `lines` measure
  without drawing
- **Shapes**: `rect` with `radius` and `dash`, `line`, `rule`, `circle`;
  fill, stroke or both
- **Table** with fixed and one flexible column, header row with its own
  style, stripes, rules, frame, per-row overrides, page breaks with the
  header redrawn
- **Barcodes**: Code 128 (auto subsets B/C with checksum) and Code 39, drawn
  as vector bars; `module` or `w` sets the width, `align` places them; leave
  a quiet zone of ten modules on each side
- **Images**: PNG (gray, RGB, palette; no alpha) and JPEG passed through
  untouched
- **Pages**: `page()`, `header` and `footer` hooks (the footer knows the
  total), automatic breaks for flow operations, mutable `margins`. A header
  draws inside the top margin: after the hook runs, the cursor is back at
  the top-left of the box
- **Scoped state**: `scope`, `at`, `indent` run a block and restore font,
  colors, cursor and margins afterwards, even when the block throws
- **Deterministic bytes**: no date or ID unless you pass `date:`; two builds
  of the same document are byte-identical

## Mental model

The page is a sheet with the origin at the top-left. Every number you pass
or read is in the document's `unit` (`'pt'` by default; `'in'`, `'mm'`,
`'cm'`), except font sizes and tracking, which are always points. A `text`
call's `y` is the top of its line box; the baseline sits `ascent × size`
below it. Positioned calls (`x:`/`y:`) draw where you say and move the
cursor to the end of the run unless you pass `move: false`; flow calls
(`puts`, `paragraph`, `down`, `table` without a position) start at the
cursor, advance it, and break pages when they run out of room.

```coffee
doc = PDF.new 'a4', 'mm', 'times', 11      # positional sugar, any order
doc = PDF.new paper: 'a4', unit: 'mm', font: 'times', size: 11   # the same
```

Options are validated: an unknown key, paper, unit, color or font key
throws immediately, naming what it saw and what it accepts; so does a
coordinate or size that is not a finite number.

## Fonts

Twelve core keys: `helvetica`, `times`, `courier`, each plain or with `B`,
`I`, `BI`. Embed a static TrueType (`.ttf` with `glyf` outlines) under any
other key:

```coffee
doc.register 'inter', Bun.file('fonts/Inter-Regular.ttf').bytes!
doc.font 'inter', 9
```

The header hook runs for page one inside the constructor, so a header that
uses an embedded font needs it registered up front: pass `fonts: { inter:
bytes }` as a document option.

WOFF, WOFF2, OpenType CFF and collections are rejected by name — convert
them to a static `.ttf` first. Only fonts that text actually uses are
written into the file. Text is WinAnsi (cp1252): Latin-1 plus the usual
typographic characters (`— – “ ” ‘ ’ … • € ™`). A character outside that
set throws, and so does a WinAnsi character the embedded font has no glyph
for; `PDF.winAnsi str` lets you check user data at intake.

`fonts/` holds pre-subset Inter and JetBrains Mono (OFL) for the demo.

## Colors

`'#rrggbb'`, `'#rgb'`, `[r, g, b]` (0–255), a number 0..1 for gray,
`'black'` or `'white'`. `color` is for text, `fill` and `stroke` for
shapes; each draw call also accepts them inline, where `true` means the
current color and `false` means none. Operators are written to the page
only when a value changes.

## Table

```coffee
doc.table rows,
  x: 36, y: 200, w: 540, rowH: 18, pad: 6
  cols: [{ w: 60, font: 'courier' }, {}, { w: 80, align: 'right' }]
  header: ['Code', 'Description', 'Amount']
  head: { fill: '#222', color: 'white', upper: true, tracking: 0.3 }
  stripe: '#f6f6f6', rule: '#ddd', frame: '#999'
  row: (cells, i) -> { color: '#a3a3a3' } if cells[0] is '·'
```

Exactly one column may omit `w` and takes the remaining width. A cell wider
than its column throws, naming the row and column, unless that column sets
`overflow: 'ellipsis'`. Across a page break the header is redrawn (never
left alone at the foot of a page) and the frame closes and reopens; the
return value is the total height drawn.

## Output

`doc.bytes!` finalizes the document (running footer hooks), returns a
`Uint8Array`, and is idempotent. Drawing after that throws. Write it with
`Bun.write`, return it from a route, or hand it to a browser as a Blob.

## Demo

```bash
bun run demo            # writes requisition.pdf to the OS temp dir (or pass a path)
```

`demo.rip` builds a one-page laboratory requisition — embedded fonts, a
Code 128 barcode, rounded cards, a twelve-slot striped table and signature
blocks — from the kind of data a form usually reaches paper from through
an HTML template and headless Chrome.

## Test

```bash
bun run test
```

The suite pins the export surface and browser safety, header/trailer/xref
structure (every offset re-parsed and checked), byte-identical builds,
core widths against the AFMs, wrapping, alignment, page breaks and hooks,
scoped state, colors and operators, Code 128 vectors, hand-built PNG and
JPEG headers, TrueType parsing and embedding, the table, and the demo.
When poppler's `pdfinfo` and `pdftotext` are on PATH they act as an
external oracle; otherwise those cases print as skipped.
