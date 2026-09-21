<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip TUI

> **Terminal user interfaces from Rip components — one reactive tree, a cell-rounded flexbox, and a diffed cell painter, zero dependencies.**

A compiled `render` block already calls `document.createElement` and
`insertBefore` directly and keeps one effect per dynamic binding, so a
terminal needs no reconciler: `run` installs a terminal `document`,
mounts the app onto it, and every later change arrives through a node
setter the package owns. A node is one object for the tree, the layout,
and the paint. Layout is flexbox in float math, rounded to cells once;
paint fills a grid of typed arrays, and only the cells a change may
have recolored; and each frame is sent as the difference from the grid
the terminal already shows, in one write.

**Runtime:** not browser-safe — it writes escape sequences to a
terminal stream and measures text with `Bun.stringWidth`. Apps run
through `rip app.rip`.

## Quick Start

```coffee
import { run, quit, screen, Box, Text, Spacer } from 'rip/tui'

App = component
  passed := 0

  ~>
    timer = setInterval (-> passed += 1), 100
    -> clearInterval timer

  ~> quit() if passed >= 50

  render
    Box borderStyle: 'round', paddingX: 1, flexDirection: 'row', width: 40
      Text color: 'green', bold: true
        "#{passed} passed"
      Spacer
      Text dimColor: true
        "#{screen.cols}×#{screen.rows}"

run App
```

`run` returns `{ app, done, quit, flush }`; `done` resolves with the
value given to `quit`. Ctrl-C quits. The last frame stays in the
scrollback and the cursor lands on the line below it.

## Widgets and styles

A box is a `div` and text is a `span`. `Box`, `Text`, and `Spacer` are
four-line components over them, and the raw tags are the zero-overhead
spelling of the same nodes. Every prop a widget does not declare is a
terminal style, forwarded to its node as written; bare text under a
box is a text leaf, and text nested in text restyles its own words.

| Moves boxes | Recolors cells |
|---|---|
| `flexDirection`, `flexWrap`, `flexGrow`, `flexShrink`, `flexBasis`, `flex` | `color`, `backgroundColor` — a name (`red`, `greenBright`, `gray`), `'#rrggbb'`, `'rgb(r, g, b)'`, `'ansi256(n)'`, or `'default'` for the terminal's own |
| `alignItems`, `alignSelf`, `alignContent`, `justifyContent` | `bold`, `dimColor`, `italic`, `underline`, `strikethrough`, `inverse` |
| `gap`, `rowGap`, `columnGap` | `borderColor`, `borderDimColor`, `borderBackgroundColor`, and each per edge (`borderTopColor` …) |
| `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` — a number, `'50%'`, or `'auto'` | |
| `padding`, `margin`, and their `X`, `Y`, `Top`, `Right`, `Bottom`, `Left` forms; a margin may be `'auto'` | |
| `position` (`'relative'`, `'absolute'`, `'static'`) with `top`, `right`, `bottom`, `left` | |
| `aspectRatio`, `boxSizing`, `display` (`'flex'`, `'none'`, `'contents'`), `hidden` | |
| `borderStyle`: `single`, `double`, `round`, `bold`, `singleDouble`, `doubleSingle`, `classic`, `arrow`, or an object of eight glyphs; `borderTop` / `borderRight` / `borderBottom` / `borderLeft: false` drops an edge | `contentOffsetX`, `contentOffsetY` — shift a box's children; a scroll is a repaint and runs no layout |
| `overflow`, `overflowX`, `overflowY`: `'visible'` or `'hidden'` (clips to the padding box) | |
| On `Text`: `wrap` — `'wrap'` (the default: words wrap, and a word longer than the line breaks), `'hard'`, `'truncate'` / `'truncate-end'`, `'truncate-start'`, `'truncate-middle'` (with `…`) | On `Text`: `link` — a URL; the words are a hyperlink (OSC 8) |

Text is measured by grapheme cluster — a flag, a family emoji, a letter
with its combining marks each take the cells a terminal gives them —
and control characters are stripped when the text is set: styling
comes from props, never from escape sequences inside a string: an
escape sequence in a text is removed whole, as a terminal would
swallow it, so a filename or a log line cannot repaint the screen.

A cluster is as wide as `string-width` 8 says, the measure Ink lays
text out by, and a terminal may count differently. Thai `กำ` (U+0E01
U+0E33) is one cluster and one cell by that rule, where
`Bun.stringWidth` says two; Devanagari `कि` (U+0915 U+093F) is two
cells by that rule and one by `Bun.stringWidth`. After every cluster
of several code points the painter places the cursor by column, so a
terminal that disagrees misdraws that one glyph and nothing after it.
A single code point is left to the width every terminal gives it, with
no move after it — unless it is unassigned in the Unicode this runtime
knows: U+1F6D9, unassigned in Unicode 17, is one cell here and in
`Bun.stringWidth`, a later terminal may draw it wide, and the move
after it keeps the rest of its run in place. A private use code point
(a powerline or icon-font glyph) is one cell and gets no move.

A `backgroundColor` on a box fills it inside its border, and that is
all it does: text with no background of its own takes the background
of the cell it lands on, whoever painted it, so a badge laid over a
colored panel sits on the panel's color, and text that spills out of
a colored box is bare once it leaves it. `color`, `bold`, `dimColor`,
and the other text attributes written on a box do pass down to the
text inside it, and text nested in text adds to what the outer text
says. A custom `borderStyle` object is copied when it is written: the
box keeps those eight glyphs, and an object changed in place afterwards
shows nowhere until it is written again.
`overflow: 'hidden'` clips everything drawn inside the box, an
absolute child included.

`'default'` is the terminal's own color, for `color` and for
`backgroundColor`, and it is a color like any other. Text with
`backgroundColor: 'default'` sits on the terminal's background even
inside a colored box (SGR 49), where text with no background takes
the box's; `color: 'default'` is the terminal's foreground (SGR 39)
under an ancestor that set another; and a box with
`backgroundColor: 'default'` covers what lies under it with the
terminal's background.

`link` makes a hyperlink of a text's words (OSC 8), and text nested
in it is part of the link unless it names its own:

```coffee
Text
  "see "
  Text link: 'https://example.com/docs', underline: true
    "the docs"
```

A link that wraps is a link on every row, and the `…` of a cut line is
inside it. The sequence is closed before every cursor move and at the
end of every write, so a terminal is never left inside a link. A URL
is refused where it is written unless every character is printable
ASCII — nothing in it can end the escape sequence early — so pass
others through `encodeURI`. `link` on a box is refused, and the plain
frame of `renderToString` carries no link.

Every distinct style and every cluster of several code points is kept
in a table, and a cell holds a style in sixteen bits. The tables are
swept between frames once they pass 32,768 styles or 16,384 clusters:
whatever no cell on the screen holds is let go, so an app that animates
`'#rrggbb'` colors, or streams text in every script, runs on in bounded
memory, and the frame after a sweep is an ordinary diff.

A frame paints and compares its damage and nothing else: the cells a
change may have recolored. A text that keeps its size owes its own
words; a border or a background, the box; a color written on a box, a
clip, or a content offset, everything under it; a layout, each box that
moved, where it was and where it is; a node taken out, where it was.
Whatever lies over or under those cells is painted again inside them,
in tree order, and every subtree that holds none of them is passed
over. A frame that gains or loses rows at the bottom keeps the rows
that stay and owes the rows that come. A first frame, a resize, a frame
whose top row is another (one taller than the terminal shows its
bottom), a sweep as a paint starts, and damage past half the screen are
painted whole. One changed cell of a full
200×60 table — a text that keeps its size, which owes its words and no
survey — is about 1 µs of paint and diff where the whole frame is about
125 µs; a change that is surveyed costs a few more — a row recolored in
a 2,000-row clipped log is about 7 µs where the whole frame is about
85 µs — and the bytes are the same (Apple M5, Bun 1.4.2; `bun run
frame` in `bench/` prints the first).

Layout is flexbox as Yoga lays it out — the defaults are Yoga's
(`flexDirection: 'column'`, `flexShrink: 0`, `alignItems: 'stretch'`,
`position: 'relative'`), and the engine is held to Yoga's own
generated suite: the left-to-right half of all 543 cases runs, and
none is skipped. Where this engine answers differently on purpose,
the answer is pinned with its reason (PLAN §5) — above all, every
edge rounds from its absolute position, so neighbors never overlap or
gap.

An absolute node positions against its parent, since a box is
`position: 'relative'` unless it says otherwise. Mark the boxes
between as `position: 'static'` and it positions against the nearest
ancestor that is not — which is how a badge or a dialog written deep
in the tree reaches an outer box. An `aspectRatio` counts cells, which
are about twice as tall as wide: a box that looks square asks for
about 2.

`style:` takes the same keys as an object. `role` and `aria-*` are kept
on the node. Anything else is refused by name — an unknown style with
the nearest real one (`'flexDirecton' is not a terminal style of <div>
— did you mean 'flexDirection'?`), a tag other than `div` and `span`, a
class, a string `style`. An error about a style ends with the node it
was written on — its tag, its `id` or `data-part`, and the way to it,
as `(on div > div#list > span[data-part=label])`; a node is styled
before it is attached, so a first write names the node alone. A child
that fails to construct throws from `run`; it never leaves a silent
hole in the screen.

## Measuring a node

A `ref:` on a raw tag holds the node, and its `box` is a reactive read
of the rounded rectangle the last layout gave it:

```coffee
Gauge = component
  el := null
  wide ~= el?.box.w ?? 0
  render
    Box flexDirection: 'row'
      div ref: el, flexGrow: 1
      Text "#{String(wide).padStart 3} cells free"
```

The readout keeps one width whatever it says. A binding that reads a
box and then changes that box's size must have a size at which both
agree; text that grew with the number it printed would not, and the
frame is refused after 32 passes with no answer.

## Testing an app

`mount` is `run` without a terminal: it mounts the app once, hands it
back, and draws a frame when the test asks for one.

```coffee
import { mount } from 'rip/tui'

view = mount Counter, cols: 40, rows: 10, props: { count: 3 }
view.frame()                # "count 3" — lay out, paint, the frame as plain text
view.app.count.value = 7    # public state is set from outside
view.frame()                # "count 7"
view.ansi                   # that frame with its escape sequences
view.bytes                  # what a terminal was sent for it: the 7, and the moves to reach it
view.damage                 # the cells that frame painted and compared: 7, the text's words
view.resize 20, 5           # the next frame is drawn whole, 20 by 5
view.close()                # unmount, and give the process its `document` slot back
```

Nothing is drawn until `frame` asks, so a frame that fails — a layout
that never settles — throws from `frame`, to the test that asked for
it. `bytes` is the difference from the frame
before, exactly as `run` writes it; a frame that changes no cell sends
nothing. With `rows`, a frame taller than the terminal shows its
bottom, as it does on a terminal; without, the terminal is as tall as
the frame. `damage` counts the cells the frame owed, which is how a
test holds an update to a small repaint; `mount App, damage: false`
(and `run`) owes every cell of every frame, for a frame to compare
against. A `quit` from the app closes the mount and resolves
`view.done` with its value.

The terminal document is a global of the process, so one app is
mounted at a time: a second `mount`, `run`, or `renderToString` is
refused by name until the first is closed — close in a `finally`.

`renderToString App, cols: 40` is a mount, one frame, and a close; it
takes `props`, and `ansi: true` keeps the escape sequences.

## What is here, and what is planned

[PLAN.md](PLAN.md) is the design and the order of work: key input and
focus, mouse, the app lifecycle, scrollback output, and the published
comparison with Ink. `bench/` holds the harness, both contenders
(`bun run ink`, `bun run tui`), and the cost of one frame, whole and
damaged (`bun run frame`).

## Demo

```bash
bun run demo
```

A two-pane test run drawn live, each change one diffed write.

## Test

```bash
bun run test
```

`test.rip` covers the document's contract and its refusals, layout and
cell rounding, `if` / `else` and keyed `for` on a terminal, nested text
styles, hyperlinks byte for byte, `ref:` metrics, the grid diff replayed
through a terminal, 70,000 colors and 300,000 clusters through the
swept tables, a running app from first frame to `quit`, the `mount`
driver, and what each kind of change owes a frame, by its cells.
`test/damage.rip` changes random trees a step at a time and holds every
frame painted from its damage to the same tree painted whole, cell for
cell, and to the bytes sent, replayed. `test/text.rip` holds the
text engine — sanitizing, cluster widths, every wrap and truncate mode
— and `test/layout.rip` the layout engine's own pins. `test/yoga.rip` runs Yoga's
543 generated layout cases, vendored unmodified under `test/yoga/`
(MIT, © Meta Platforms), against the engine through a shim of the
`yoga-layout` API. `test/yoga-aspect.rip` is a port of Yoga's 37
hand-written aspect ratio cases, and `test/yoga-hand.rip` of 53 more:
measure functions, the measure cache, measure modes, rounding a
measured size, dirtying, and computed edges.
