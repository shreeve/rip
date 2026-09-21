<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip TUI

> **Terminal user interfaces from Rip components — one reactive tree, a cell-rounded flexbox, and a diffed cell painter, zero dependencies.**

A compiled `render` block already calls `document.createElement` and
`insertBefore` directly and keeps one effect per dynamic binding, so a
terminal needs no reconciler: `run` installs a terminal `document`,
mounts the app onto it, and every later change arrives through a node
setter the package owns. A node is one object for the tree, the layout,
and the paint. Layout is flexbox in float math, rounded to cells once;
paint fills a grid of typed arrays; and each frame is sent as the
difference from the grid the terminal already shows, in one write.

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
| `flexDirection`, `flexWrap`, `flexGrow`, `flexShrink`, `flexBasis`, `flex` | `color`, `backgroundColor` — a name (`red`, `greenBright`, `gray`) or `'#rrggbb'` |
| `alignItems`, `alignSelf`, `alignContent`, `justifyContent` | `bold`, `dimColor`, `italic`, `underline`, `strikethrough`, `inverse` |
| `gap`, `rowGap`, `columnGap` | `borderColor`, `borderDimColor`, `borderBackgroundColor`, and each per edge (`borderTopColor` …) |
| `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` — a number, `'50%'`, or `'auto'` | |
| `padding`, `margin`, and their `X`, `Y`, `Top`, `Right`, `Bottom`, `Left` forms; a margin may be `'auto'` | |
| `position` (`'relative'`, `'absolute'`, `'static'`) with `top`, `right`, `bottom`, `left` | |
| `aspectRatio`, `boxSizing`, `display` (`'flex'`, `'none'`, `'contents'`), `hidden` | |
| `borderStyle`: `single`, `double`, `round`, `bold`, `singleDouble`, `doubleSingle`, `classic`, `arrow`, or an object of eight glyphs; `borderTop` / `borderRight` / `borderBottom` / `borderLeft: false` drops an edge | `contentOffsetX`, `contentOffsetY` — shift a box's children; a scroll is a repaint and runs no layout |
| `overflow`, `overflowX`, `overflowY`: `'visible'` or `'hidden'` (clips to the padding box) | |
| On `Text`: `wrap` — `'wrap'` (the default: words wrap, and a word longer than the line breaks), `'hard'`, `'truncate'` / `'truncate-end'`, `'truncate-start'`, `'truncate-middle'` (with `…`) | |

Text is measured by grapheme cluster — a flag, a family emoji, a letter
with its combining marks each take the cells a terminal gives them —
and control characters are stripped when the text is set: styling
comes from props, never from escape sequences inside a string: an
escape sequence in a text is removed whole, as a terminal would
swallow it, so a filename or a log line cannot repaint the screen.

A `backgroundColor` on a box fills it inside its border, and that is
all it does: text with no background of its own takes the background
of the cell it lands on, whoever painted it, so a badge laid over a
colored panel sits on the panel's color, and text that spills out of
a colored box is bare once it leaves it. `color`, `bold`, `dimColor`,
and the other text attributes written on a box do pass down to the
text inside it, and text nested in text adds to what the outer text
says. A custom `borderStyle` object is read when it is written.
`overflow: 'hidden'` clips everything drawn inside the box, an
absolute child included.

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
class, a string `style`. A child that fails to construct throws from
`run`; it never leaves a silent hole in the screen.

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

`renderToString App, cols: 40` mounts the app on a private document and
returns the frame as text; `ansi: true` keeps the escape sequences.
State a test changes redraws on the next call.

## What is here, and what is planned

[PLAN.md](PLAN.md) is the design and the order of work: text wrapping
and clipping, damage tracking, key input and focus, mouse, the app lifecycle, scrollback
output, and the published comparison with Ink. `bench/` holds the
harness and both contenders (`bun run ink`, `bun run tui`).

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
styles, `ref:` metrics, the grid diff replayed through a terminal, and
a running app from first frame to `quit`. `test/text.rip` holds the
text engine — sanitizing, cluster widths, every wrap and truncate mode
— and `test/layout.rip` the layout engine's own pins. `test/yoga.rip` runs Yoga's
543 generated layout cases, vendored unmodified under `test/yoga/`
(MIT, © Meta Platforms), against the engine through a shim of the
`yoga-layout` API, and `test/yoga-aspect.rip` is a port of Yoga's 37
hand-written aspect ratio cases.
