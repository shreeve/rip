<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip TUI

> **Terminal user interfaces from Rip components — one reactive tree, a cell-rounded flexbox, and a diffed cell painter, zero dependencies.**

Ink is React driving a fake DOM, Yoga laying it out through
WebAssembly, and a string painter writing the result. Rip needs none
of that between a component and the terminal. A compiled `render`
block already calls `document.createElement` and `insertBefore`
itself and keeps one effect per dynamic binding, so `run` installs a
terminal `document`, mounts the app onto it, and every later change
arrives through a setter the package owns, naming the node that
changed: no reconciler, no tree diff. One object is the tree node,
the layout node and the paint node. Layout is flexbox as Yoga lays it
out, in float math rounded to cells once; paint fills a grid of typed
arrays, and only the cells a change may have recolored; and each
frame is sent as the difference from the grid the terminal already
shows, in one write. The claim is three things: fewer lines than Ink
and Yoga together, less time per update on the same Bun, and clearer
programs. The four examples below show the third, and `bench/` is
where the first two are measured, against Ink on the same Bun
([PLAN.md](PLAN.md) §2 says what each means).

**Runtime:** not browser-safe — it writes escape sequences to a
terminal stream and measures text with `Bun.stringWidth`. Apps run
through `rip app.rip`.

## Quick start

The smallest app that takes a key, `examples/counter.rip`:

```coffee
import { run, Box, Text } from 'rip/tui'

Counter = component
  @count := 0
  pressed: (event) ->
    @count += 1 if event.key is 'ArrowUp'
    @count -= 1 if event.key is 'ArrowDown'
  render
    Box @keydown: @pressed, focusable: true, autofocus: true, borderStyle: 'round', paddingX: 1
      Text color: 'green', "count #{@count}"

run Counter
```

```bash
bun install                # once, at the repository root
rip examples/counter.rip   # from packages/tui: ↑ and ↓ count, Ctrl-C quits
```

`run` returns `{ app, done, quit, flush }`; `done` resolves with the
value given to `quit`. Ctrl-C quits. The last frame stays in the
scrollback and the cursor lands on the line below it.

## What it does

Every row of the first two columns is built and under test;
[TODO.md](TODO.md) lists the open work within them, most of it cost.

| Matches Ink | Beyond Ink | Disclosed gaps | Never |
|---|---|---|---|
| Flexbox layout incl. baseline, static position, and aspect ratio; borders, backgrounds | Mouse, opt-in: click, wheel, hover, and a drag that selects text to the clipboard | Screen-reader output mode (`role` / `aria-*` are accepted and kept on the node) | React devtools |
| `overflow: hidden` clipping | Keys bubble from the focused node, with preventable default actions | Windows — unclaimed and untested, as for Rip itself | Concurrent rendering, Suspense |
| Scrolling by content offset (`contentOffsetX` / `contentOffsetY`) | Tree-order focus | List virtualization | |
| Wrap and truncate modes | Node-relative cursor placement | | |
| `Static` scrollback output | A text change of unchanged size runs no layout | | |
| Inline and alternate-screen rendering | Hyperlinks as a prop: `link` on text (OSC 8), refused unless the URL is printable ASCII, never left open across a cursor move | | |
| Synchronized, diffed, coalesced output | | | |
| Non-TTY / CI output, `NO_COLOR`, color depth | | | |
| Console capture while rendering | | | |
| Error display with terminal restore | | | |
| `renderToString` and a test driver | | | |
| Node metrics (`useBoxMetrics` equivalent) | | | |
| Key input, paste, focus, cursor placement | | | |
| Enhanced keyboard (kitty protocol), opt-in | | | |
| Animation clock (`useAnimation` equivalent) | | | |

Ink's string `Transform` has no counterpart because it has no job
here: a text transform is an ordinary expression in the binding
(`"#{name.toUpperCase()}"`).

## Side by side with Ink

Four of Ink's own examples, ported program for program under
`examples/ink/`, with Ink's `.tsx` beside each `.rip`. Each port draws
the frames Ink 7.1.1 draws for the same example — `test/examples.rip`
holds every one of them, and none differs — and `rip test/lines.rip`
counts the lines: non-blank and non-comment, the rule
[PLAN.md](PLAN.md) §2 states.

| Example | Ink | Rip TUI | |
|---|---|---|---|
| `counter` | 15 | 6 | A number that climbs every 100 ms: a `clock` read in the text, where Ink has a state, an effect and a timer to clear. |
| `borders` | 34 | 21 | The seven named border styles in two rows: Ink's tree, with the rows said, since `Box` is a column here as in Yoga and a row in Ink. |
| `use-focus` | 26 | 19 | Three items Tab moves between: a `focusable` node styled by its own `focused`, where Ink registers a hook; Ink's Escape is a listener on the root box. |
| `static` | 45 | 14 | Ten tests into the scrollback, one every 100 ms, above a live count: `Static` around a keyed `for`; the app quits with the tenth, where Ink's process ends when its last timer has run. |

Run one with `rip examples/ink/counter.rip`.

## The numbers

`bun run bench` in `bench/` runs both sides on the same scenarios —
the same tree, node for node, against the same fake 200×60 terminal —
each in a fresh process, five times, and writes
[bench/RESULTS.md](bench/RESULTS.md):
every number reproduces with `bun run bench`.
Ink is measured as a careful React app is written:
React's production build, memoized rows, `interactive: true`,
incremental rendering on, its frame throttle lifted, every update
awaited to the write that ends its frame. A number is published only
when a terminal reducer (`bench/harness.rip`) has replayed what each
side wrote and read the same screen after every update, scrollback
included, cell for cell, text and style; a scenario whose screens
differ is refused from the table with the first differing cell in its
place. [PLAN.md](PLAN.md) §11 says how, and where the table does not
flatter.

CPU in microseconds per update, latency from the state change to the
write in milliseconds (the median of five runs and half their spread),
bytes and writes per update; Apple M5, Bun 1.4.2, Ink 7.1.1, React
19.3.0:

| Scenario | Ink cpu µs | p50 ms | p99 ms | bytes | writes | Rip TUI cpu µs | p50 ms | p99 ms | bytes | writes | Same screen |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|:--|
| counter in a 1,000-element tree | 3638 ±163 | 2.99 ±0.13 | 3.93 | 347 | 3.0 | 18 ±1 | 0.00 ±0.00 | 0.02 | 33 | 1.0 | ✓ |
| 40×8 table, 10% churn | 3413 ±89 | 2.39 ±0.12 | 3.41 | 5669 | 3.0 | 216 ±2 | 0.06 ±0.00 | 0.50 | 262 | 1.0 | ✓ |
| 40×8 table, 100% churn | 4241 ±39 | 3.44 ±0.06 | 4.48 | 7052 | 3.0 | 343 ±7 | 0.12 ±0.01 | 0.82 | 1985 | 1.0 | ✓ |
| 2,000-row list, scroll by one | 22346 ±614 | 19.93 ±0.60 | 21.86 | 2501 | 3.0 | 181 ±7 | 0.08 ±0.00 | 0.20 | 273 | 1.0 | ✓ |
| 10,000-row list, scroll by one | 105608 ±230 | 97.19 ±0.51 | 102.29 | 2500 | 3.0 | 303 ±48 | 0.13 ±0.00 | 0.49 | 276 | 1.0 | ✓ |
| insert at the top of a 50-row list | 2740 ±46 | 2.34 ±0.04 | 3.00 | 3155 | 3.0 | 422 ±16 | 0.09 ±0.00 | 0.22 | 344 | 1.0 | ✓ |
| 1,000 scrollback appends | 334 ±8 | 0.11 ±0.00 | 0.57 | 55 | 5.0 | 147 ±1 | 0.05 ±0.00 | 0.11 | 57 | 1.0 | ✓ |
| resize 120 → 80 → 120, 12×4 wrapped | 2049 ±96 | 0.99 ±0.01 | 1.81 | 4295 | 3.5 | 701 ±10 | 0.16 ±0.00 | 0.32 | 6635 | 1.0 | ✓ |
| full relayout of 10,000 nodes | 7753 ±175 | 6.08 ±0.19 | 7.84 | 388 | 3.0 | 2325 ±41 | 1.37 ±0.06 | 2.49 | 380 | 1.0 | ✓ |
| 20×8 table of CJK and emoji, churning | 2728 ±49 | 1.90 ±0.04 | 2.73 | 3791 | 3.0 | 414 ±5 | 0.19 ±0.00 | 0.56 | 990 | 1.0 | ✓ |

| Cold start | import ms | first frame ms after import | process start → frame ms |
|---|--:|--:|--:|
| Ink 7.1.1 | 39.5 | 4.5 | 70.6 |
| Rip TUI | 8.6 | 3.4 | 39.0 |

Lines of code, by the rule above (`bun run lines`):

| | Ink + Yoga | Rip TUI |
|---|--:|--:|
| Framework only | Ink `src/` 6,760 | 4,252 |
| Framework + layout algorithm | + Yoga `yoga/algorithm/` 3,492 = 10,252 | 4,252 (layout.rip is 1,466 of it) |
| Full runtime closure | + React, react-reconciler, scheduler and 33 more packages | + Rip runtime 1,598 = 5,850 |

Ink + Yoga is 2.4× the lines of this package with the layout algorithm
on both sides, 1.6× framework against framework. Two rows where the
table is not one-sided: after a resize the frame is drawn from
nothing, which is more bytes than Ink's incremental log writes; and a
`Static` append grows with the items already written — about 150 µs
averaged over 1,000 appends, 350 over 8,000 — where Ink's stays flat,
so past a few thousand appends Ink is the faster side.

## Examples

Each runs with `rip examples/<name>.rip` from `packages/tui`.

| Example | Shows |
|---|---|
| `counter.rip` | The quick start: a key changes state, the frame follows. |
| `files.rip` | A file browser: two panes as tall as the terminal, clipped and scrolled by content offset; Tab and a click move between them; the wheel scrolls the pane under it; the row under the pointer is underlined (`mouse: 'all'`); Enter opens a directory, Backspace goes up, q quits. |
| `log.rip` | A build log: finished steps into the scrollback through `Static`, a spinner and a bar on the `clock`, a warning above the frame through `print`, the terminal's own progress indicator, and a quit when the last step is done. |
| `input.rip` | A single-line text field in 40 lines of code: the cursor placed by measured cells, so a wide glyph is two columns and a letter with its marks one; typing inserts at the cursor, the arrows, Home and End move it, Backspace and Delete take a cluster, a paste goes in whole, Enter prints the value above the field and clears it, Escape clears it. |
| `ink/*.rip` | The four ports above, Ink's source beside each. |

`log.rip`, `input.rip` and the ports export their component and run it
only as the entry (`run App if import.meta.main`), which is how
`test.rip` and `test/examples.rip` drive them headless through
`mount`.

## Running

`run App, options` takes the terminal for the app's life and gives it
back on every way out, by one road:

- **Exit.** `quit()`, Ctrl-C, a listener that throws, a frame that
  fails, or a script whose loop drains: the last frame stays in the
  scrollback, the cursor lands below it, and stdin, the terminal's
  modes and the process's handlers are as they were. A failure leaves
  what reached the screen, and `done` rejects with it.
- **Signals.** SIGINT, SIGTERM and SIGHUP give the terminal back and
  exit with 128 plus the signal's number; a `done` an app awaits never
  settles after a signal exit, since the process is gone before any
  continuation runs. An uncaught error or an unhandled rejection gives
  the terminal back, rejects `done` with the error, and leaves it to
  the runtime — which prints it and exits 1 — or to the app's own
  handler, once; a `process.exit` with the app live gives the terminal
  back on the way.
- **Suspend.** Ctrl-Z gives the terminal back and stops the job as the
  terminal would — the whole process group, so under `rip app.rip` the
  shell sees one stopped job; `fg` draws the app again, whole, at the
  terminal's size now, whether or not the app has a timer. It is a
  default action of `keydown`, preventable like Ctrl-C. The stop
  signal is sent only when the app reads the process's own stdin: with
  any other stream — a test's, or a `stdout:` given with no stdin —
  Ctrl-Z takes the same road and sends nothing, since a stream of one's
  own is not the terminal's job, and whoever gave it continues the app
  with `process.kill process.pid, 'SIGCONT'`. `suspend fn` is the same
  road without the signal — the terminal is `fn`'s until it settles:

  ```coffee
  import { suspend } from 'rip/tui'
  suspend! -> Bun.spawn(['vim', path], stdio: ['inherit', 'inherit', 'inherit']).exited
  ```

  A key that arrives meanwhile is nobody's; a `quit` meanwhile closes
  the app without taking the terminal back.
- **Alternate screen.** `run App, altScreen: true` draws on the
  terminal's alternate screen from its top-left; every way out leaves
  it after the last frame, so the frame vanishes and the shell's own
  screen comes back where it was. `Static` is nothing there.
- **CI and pipes.** On a stdout that is no terminal, or with `CI` set,
  nothing is asked of the terminal and the last frame alone is
  written, as text, at exit; `screen.interactive` reads false.
- **Colors.** The depth is read once at `run` and `screen.colors`
  reads it: 0, 16, 256 or 16777216. `NO_COLOR` set to anything but the
  empty string is none; `FORCE_COLOR` `0` or `false` is none, empty or
  `true` the 16, a number that depth up to 3, any other word the 16;
  otherwise a pipe, CI or a dumb terminal is none, `COLORTERM`
  `truecolor` 24-bit, `TERM` `256color` 256, and any other terminal
  16. A 24-bit color is drawn as the nearest of xterm's 256 — a color
  on the cube as that point — and below that as the nearest of xterm's
  16.
- **Console.** While the app runs, every console method that writes
  (`log`, `table`, `group`, `trace`, `assert`, `count`, `time*`, …)
  clears the frame, writes where it always went, and draws the frame
  again below, so logs scroll into the scrollback above the app; on the
  alternate screen they are kept and replayed at exit. `run App,
  console: false` leaves the console alone.

## Widgets and styles

A box is a `div` and text is a `span`. `Box`, `Text`, and `Spacer` are
four-line components over them, and the raw tags are the zero-overhead
spelling of the same nodes. Every prop a widget does not declare is a
terminal style, forwarded to its node as written; bare text under a
box is a text leaf, and text nested in text restyles its own words.
`Newline count: n` is `n` line breaks inside text, and `Static` is the
scrollback (below).

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

view = mount Counter, cols: 40, rows: 10, props: { count: 3 }   # mouse:, keyboard:, selection: as `run` takes them
view.frame()                # "count 3" — lay out, paint, the frame as plain text
view.app.count.value = 7    # public state is set from outside
view.frame()                # "count 7"
view.ansi                   # that frame with its escape sequences
view.bytes                  # what a terminal was sent for it: the 7, and the moves to reach it
view.damage                 # the cells that frame painted and compared: 7, the text's words
view.resize 20, 5           # the next frame is drawn whole, 20 by 5
view.press 'Tab'            # one key, by DOM's name or a character
view.press 'c', ctrl: true  # with `ctrl`, `shift`, `alt`, `meta`, `repeat`
view.type 'hello'           # text as a terminal sends it: a key per code point
view.paste 'two\rlines'     # one paste event
view.send '\x1b[1;5A'       # raw bytes, through the parser: keys, mouse reports, the terminal's answers
view.tick 50                # move the parser's clock: a lone ESC is Escape after 50 ms
view.focused                # the node that has focus, or null
view.cursor                 # where the last frame parked the cursor, { x, y }, or null while hidden
view.scrollback             # what `Static` and `print` wrote above the frame so far, as it was written
view.stderr                 # what `print.err` wrote
view.close()                # unmount, and give the process its `document` slot back
```

Input takes the road `run` reads stdin by — the same dispatch, the same
default actions — and draws nothing: ask for the frame.

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
takes `props`, and `ansi: true` keeps the escape sequences. The rows
the app's `Static` items wrote come first, then the frame. A child that
fails to construct — at the mount, from a key, or from a state set by
the test — fails the mount, the key, or the next frame with the child's
own error, and a `done` is settled by `close` as well as by `quit`.

## Input and focus

`run` reads the terminal's keys and hands each to the app as an event,
the way a browser does. A key is a `keydown` sent to the node that has
focus, or to `document.body` while nothing has it. It runs the capture
phase from the document down to that node, then the node's own
listeners, then bubbles back up to the document, and any listener may
stop it there (`stopPropagation`) or keep its default action from
running (`preventDefault`). A handler for every key the app is sent is
one on the document, or one on a root box that holds focus, as the
select list below does; a box under the body that nothing focuses hears
no key, as a browser's would not.

```coffee
Select = component
  @items := []
  @chosen := null
  at := 0
  el := null
  move: (event) ->
    switch event.key
      when 'ArrowDown' then @at = (@at + 1) % @items.length
      when 'ArrowUp'   then @at = (@at - 1 + @items.length) % @items.length
      when 'Enter'     then @chosen = @items[@at]
  render
    div ref: el, focusable: true, autofocus: true, @keydown: @move, borderStyle: 'round', borderColor: (if el?.focused then 'cyan' else 'gray')
      for item, n in @items
        Text key: item, inverse: n is at
          "#{item}"
```

The event is DOM's `KeyboardEvent` in what it carries — `key`
(`'Enter'`, `'ArrowUp'`, `'F5'`, or one code point), `ctrlKey`,
`shiftKey`, `altKey`, `metaKey`, `repeat`, and `sequence`, the bytes as
they came — and DOM's `Event` in how it travels: `target`,
`currentTarget`, `eventPhase` (1 capture, 2 target, 3 bubble),
`defaultPrevented`, `stopPropagation()`, `stopImmediatePropagation()`,
`preventDefault()`. One event object is handed to every listener of a
key, and one handler under one type and phase is one listener, however
often it is added. The path is the tree as the dispatch began, so a
listener that changes the tree changes nothing of who hears that key;
a stop ends the dispatch wherever it is asked for, a capture listener
on the target included.

| Event | Sent to | Carries | Bubbles |
|---|---|---|---|
| `@keydown` | the focused node, or `document.body` | the key's fields | yes |
| `@paste` | the same | `text`, the whole paste; never key events | yes |
| `@focus`, `@blur` | the node that takes or loses focus | | no, as DOM's do not; the capture phase reaches them |
| a component's `emit 'name', detail` | the component's root | `detail` | yes |

A listener asks for the capture phase by a name that ends in `Capture`
— `@keydownCapture: handler`, which is how a dialog takes a key before
the node under it does — or, on a node in hand, by
`node.addEventListener 'keydown', handler, true` (or `{ capture:
true }`). `document.addEventListener` hears every key last, or first
when it captures.

**Default actions** run after the listeners, for a key none of them
prevented:

| Key | Does | Keep the key with |
|---|---|---|
| Tab, Shift-Tab (no Ctrl, Alt or Meta) | focus to the next or the previous node | `event.preventDefault()` — a text input that takes Tab |
| Ctrl-C | `quit()` | `event.preventDefault()` — an app that asks before it leaves |
| Escape | nothing: closing a dialog or clearing an input is the app's | |

Once the app is closing, what is left of the same read is dropped.

**Focus** belongs to a node. Any element is `focusable: true`;
`disabled: true` on a node or on anything above it, `hidden`, and
`display: 'none'` take a node and everything under it out of reach. Tab
follows the tree's order, found by a walk when Tab is pressed, so a
list that is reordered is walked as it stands, and a focused node that a
reorder moves keeps its focus. A focused node that is removed, hidden or
disabled loses focus to nothing — the next Tab starts from the top —
and hears `blur`. `autofocus: true` is a claim made once, when the node
arrives, as HTML's is: the first such node in tree order takes focus if
nothing has it, and never takes it from a node that does. A node that
is disabled, or not `focusable`, when its claim is settled never claims
again — enable it and it waits for Tab or `focus()` — where Ink's
`useFocus({autoFocus, isActive})` takes focus whenever it becomes
active. Inside a `focus` or `blur` listener every read agrees with the
event: `document.activeElement`, `focus.active` and `el.focused` say
the node has focus as it hears `focus`, and that nothing has it as it
hears `blur`.

```coffee
el.focus()                 # take focus, if the node can hold it
el.blur()                  # give it up
el.focused                 # a reactive read: style a node by it, through `ref:`
document.activeElement     # the node that has focus, or null
focus.active               # the same, from 'rip/tui'; a reactive read
focus.next()               # Tab's move, and Shift-Tab's
focus.previous()
focus.to node              # `node.focus()`; `focus.to null` lets go
screen.focused             # whether the terminal itself is the window in use
```

**The cursor** is hidden unless the focused node declares one:
`cursor: { x, y }`, in whole cells from the node's own top-left corner,
its border and padding included, with `x` counted in cells, so text of
wide glyphs is measured, not counted. After every frame the hardware
cursor is parked there and shown, where an input method and a screen
reader look for it. Content offsets above the node move it, and a clip
that leaves its cell out — or a frame taller than the terminal, whose
top rows are not shown — hides it. On `quit` it returns to the line
below the frame.

A text input inserts `event.key` when it is one code point, and cuts
its buffer into clusters for Backspace and for the cursor's column (the
next section says why):

```coffee
clusters = Intl.Segmenter.new undefined, { granularity: 'grapheme' }

Input = component
  @value := ''
  typed: (event) ->
    if event.key is 'Backspace'
      parts = Array.from clusters.segment(@value), (part) -> part.segment
      @value = parts.slice(0, -1).join ''
    else if Array.from(event.key).length is 1 and not event.ctrlKey and not event.altKey and not event.metaKey
      @value += event.key
  render
    Box focusable: true, autofocus: true, borderStyle: 'single', width: 20, cursor: { x: 1 + Bun.stringWidth(@value), y: 1 }, @keydown: @typed, @paste: ((event) => @value += event.text)
      Text "#{@value}"
```

`run App, stdin: stream` reads `stream`; the default is the process's
own stdin, unless `stdout` is given and `stdin` is not, since a stream
of one's own takes no keys from the terminal the process is on. A stdin
that is a terminal is set raw and asked for bracketed paste and focus
reports for the life of the app, and all of it is given back on every
way out — `quit`, Ctrl-C, a throw while the app mounts, a frame or a
listener that fails — and stdin is left paused and unref'd, so it does
not keep the process alive. A write to the terminal that fails on the way out, or a frame
that fails as `quit` draws it, still gives the rest back, and `done`
rejects with the error. A stdin that is no terminal (a pipe, CI) is
left alone: no key arrives and nothing is asked of the terminal. One
read is one frame, however many keys
it holds, and a key that changes nothing owes no frame and draws
nothing. On the select list above with ten items, an arrow key — its
bytes through the parser, the dispatch, the listener, the state change,
and the frame of 12 cells and 55 bytes it causes — is about 8 µs, and a
key no listener acts on about 0.3 µs; with a hundred items the arrow is
about 55 µs, since each item's `inverse` is a binding that reads `at`
(Apple M5, Bun 1.4.2; `bun run keys` in `bench/`).

Ctrl-Z is [PLAN.md](PLAN.md)'s lifecycle step.

## Mouse

The mouse is opt-in — `run App, mouse: true` — because reporting takes
over the terminal's own text selection, so the package provides one
(below). `true` asks the terminal for presses, releases, the wheel, and
motion while a button is held; `mouse: 'all'` asks for every motion,
for hover. Both are withdrawn on every way out with the other modes.
Each report is hit-tested — the last painted node under the cell wins,
a clip holds its children, a hidden subtree is not there, a word hits
its `Text`, padding and a border hit the box, and nothing hits
`document.body` — and the event travels the road a key does: capture,
target, bubble, `stopPropagation`, `preventDefault`.

| Event | Sent to | Carries | Default action |
|---|---|---|---|
| `@mousedown`, `@mouseup` | the node under the pointer | `x`, `y` from the node's own corner; `screenX`, `screenY`, the terminal's cell; `button` (0 left, 1 middle, 2 right); `shiftKey`, `altKey`, `ctrlKey` | none; a prevented `mousedown` keeps the drag from selecting |
| `@click` | the same, when the press and the release landed on one node with the same button and no motion between | the same | focus the nearest node from it up that can hold focus; a click on nothing focusable leaves focus where it is |
| `@wheel` | the node under the pointer | the same, and `deltaY` (-1 up, 1 down, a tick), `deltaX` | none: the handler moves `contentOffsetY` |
| `@mousemove` | the node under the pointer, when a listener would hear it | the same | none |
| `@mouseenter`, `@mouseleave` | every node the pointer entered or left, in DOM's order; neither bubbles | `screenX`, `screenY`, `relatedTarget` | none |

The node under the pointer is the last painted one whose box holds the
cell; a text is hit where its words reach, and a `Text` nested in a
`Text` is a run of words of the outer one, which is the target (DOM
would target the inner). The boxes are the last frame's and the tree is
as it stands, so a node taken out since is never hit. Outside the rows
the frame shows, a press, a release and a wheel are nothing. One press
is tracked at a time, the last: a second button pressed while one is
held ends the first press, and neither yields a click.

A scrolled list is a wheel handler on the box that clips it:

```coffee
List = component
  @items := []
  top := 0
  roll: (event) -> top = Math.max 0, Math.min(top + event.deltaY, @items.length - 3)
  render
    Box flexDirection: 'column', height: 3, overflow: 'hidden', contentOffsetY: top, @wheel: @roll
      for item in @items
        Text key: item, "#{item}"
```

A row lit while the pointer is over it, under `mouse: 'all'`:

```coffee
Row = component extends span
  @name := ''
  hovered := false
  render
    span underline: hovered, @mouseenter: (-> hovered = true), @mouseleave: (-> hovered = false)
      "#{@name}"
```

Hover needs `mouse: 'all'`: under `mouse: true` the terminal reports
motion only while a button is held, so a release leaves every node the
drag ended on, and the pointer is nowhere until the next press. What is
under a resting pointer follows the frame: a wheel that scrolls rows
under it leaves the row that moved away and enters the one that came,
with no motion needed, and a row taken out of the tree while hovered is
left. Motion is cheap. A report that keeps its target dispatches
nothing — no event is made unless a listener would hear it, for
`mousemove`, `mouseenter` and `mouseleave` alike — and draws nothing;
one that crosses from one row to the next costs the two rows' cells. On
a tree of 1,576 elements a motion report is about 0.5 µs and a click
about 1 µs, parser included (`bun run hit` in `bench/`). In inline mode
the frame is not at the terminal's first row, so with the mouse the
package asks the terminal where its cursor is (`CSI ? 6 n`) once the app
stands and after every resize, and lowers the answer when a frame
scrolls the terminal; `examples/files.rip` is the whole idiom, list and
preview.

**Selection and the clipboard.** A drag with the left button selects
the cells from the press to the pointer in reading order, as a terminal
does, painted inverse. On release the text goes to the clipboard through
OSC 52 — most terminals honor it, some ask first, and tmux needs
`set-clipboard on` — and `screen.selection`, a reactive read, is that
text until the selection goes. A press clears it, so a click does; so
do a resize, the rows under it all leaving the frame, and `quit`, which
leaves no inverse cell in the scrollback. `selection: false` turns it
off for the app; `event.preventDefault()` on the `mousedown` keeps one
drag from selecting, which is how a slider takes the drag for itself.
Shift with a button is the terminal's own selection and never reaches
the app.

**Testing.** `mount App, mouse: true` (or `'all'`) takes reports through
`send` as a terminal sends them — `view.send '\x1b[<0;4;3M\x1b[<0;4;3m'`
is a click on column 3 of row 2, counted from zero — and `view.bytes`
holds the OSC 52 write.

## Enhanced keyboard

`run App, keyboard: 'enhanced'` asks the terminal for the kitty keyboard
protocol's disambiguation flag, which tells Shift-Enter from Enter and
Ctrl-I from Tab, and makes a lone Escape arrive at once. Setup sends the
kitty query and then the device attributes query; whichever answer
comes first decides, with no timer: kitty's answer pushes the flag and
`screen.keyboard` reads `'enhanced'`; the attributes answer first —
tmux answers only that one — leaves `'basic'`. The flag is popped on
every way out. The decoder always reads kitty's sequences, so a terminal
already in that mode works without the option. Three rules for an app:

1. Never make an enhanced-only key the sole way to do something: a chat
   input that takes Shift-Enter for a new line also takes Alt-Enter or
   Ctrl-J.
2. Show the hint that matches `screen.keyboard`, a reactive read: a
   binding that shows it redraws when the terminal answers.
3. Under tmux, `set -s extended-keys on` forwards modified keys in
   xterm's form, which the decoder reads, and `set -s escape-time 10`
   stops tmux holding a lone Escape for 500 ms. Both are the user's
   settings: name them where the app documents its keys.

## Input events

`input.rip` turns the bytes a terminal sends into events — `key`,
`paste`, `focus` / `blur`, `mouse`, `reply` — and stands alone: `run`
reads stdin through it, and `mount` sends a test's bytes through it. A
`key` becomes a `keydown`, a `paste` a `paste`, and the terminal's
`focus` / `blur` reports `screen.focused`. What a text input can rely
on:

- **Typed text is one `key` event per code point**, never per grapheme
  cluster: a cluster can be cut between two reads, and only code points
  decode the same however the bytes arrive. A family emoji is five
  events. So insert `key` as it comes, and re-segment the buffer into
  clusters (`Intl.Segmenter`) for the cursor and for Backspace; never
  treat one event as one cell or one deletion.
- A key that types has a `key` of exactly one code point. Every other
  `key` is a DOM name of two or more characters — `'Enter'`,
  `'ArrowUp'`, `'F5'` — so `Array.from(event.key).length is 1` is the
  test for text, with `ctrlKey`, `altKey` and `metaKey` false.
- A paste is one `paste` event with its text as the terminal sent it,
  newlines as carriage returns where the terminal sends them so. It is
  never key events.
- Key releases are dropped: they need the kitty protocol's event-type
  reports, which the package never asks for. A held key is `repeat:
  true` where the terminal says so.
- A lone Escape arrives 50 ms after the key, since ESC also opens every
  sequence; under the enhanced keyboard it arrives at once.

## Static output

A log of finished work belongs in the scrollback, not in the frame.
`Static` around a keyed `for` writes each item once, above the live
frame, when it first appears — and never paints it in the frame, so
the frame stays the size of what is live.

```coffee
import { run, quit, print, Box, Text, Static } from 'rip/tui'

Build = component
  @done := []          # the steps finished so far
  @step := 'compile'
  render
    Box flexDirection: 'column'
      Static
        for name in @done
          Text key: name, color: 'green', "✓ #{name}"
      Text "… #{@step}"

build = run Build
build.app.done.value = ['resolve', 'fetch']   # two rows into the scrollback, the frame drawn again below
print 'warning: fetch took the slow road'     # a line above the frame, the same way; print.err for stderr
```

An item is laid out at the terminal's width, with the items that arrive
in the same frame, in tree order; `Static`'s own props — `padding`,
`margin`, `backgroundColor` — go around each such batch. Once written,
an item is done: a change to its state or its removal from the list
changes nothing on the terminal. An item under a hidden ancestor waits
until it is shown. Off a terminal the rows go out as plain text as they
arrive; on the alternate screen nothing is written above. `examples/log.rip`
is a build log this way, with a spinner and a progress bar for the
step under way.

## Animation

`clock(interval)` is `{ frame, time, delta }` as reactive reads, moved
by one timer per interval: `frame` counts the intervals since the
timer started, `time` the milliseconds, `delta` the milliseconds since
the last tick. A spinner is `frames[tick.frame % frames.length]`.

```coffee
Spinner = component
  tick = clock 80
  render
    Text color: 'cyan', "#{'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[tick.frame % 10]}"
```

The component that makes the clock in its body holds it, and every
component holding one interval shares its timer, which runs only while
one of them is mounted and has read it, and never off a terminal. Under
`mount` the clock runs on the mount's own time, so `view.tick 80` moves
the spinner a frame, as it moves the parser's waits.

## Progress

`screen.progress value` puts the app's progress on the terminal's own
indicator — the taskbar, the tab — through OSC 9;4, which Windows
Terminal, Ghostty, kitty and iTerm2 honor: a number from 0 to 1,
`'error'`, `'indeterminate'`, or `null` to clear. It goes out with the
next frame's write, and is cleared on every way out.

## What is here, and what is planned

[PLAN.md](PLAN.md) is the design and the order of work. `bench/` holds
the harness with its terminal reducer, both contenders (`bun run ink`,
`bun run tui`), the runner that proves and publishes them (`bun run
bench`, [bench/RESULTS.md](bench/RESULTS.md)), the lines of code (`bun
run lines`), and the cost of one frame, whole and damaged (`bun run
frame`), of one key (`bun run keys`), and of one mouse report (`bun run
hit`).

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
driver, what each kind of change owes a frame, by its cells, the bytes
of a `Static` write and of `print`, the mouse after one, the clock's
one timer and where it stops, and the progress sequence.
`test/damage.rip` changes random trees a step at a time and holds every
frame painted from its damage to the same tree painted whole, cell for
cell, and to the bytes sent, replayed. `test/examples.rip` drives the
four ports under `examples/ink/` through `mount` and holds each frame
to the one Ink draws for its example, holds the line table above to
what `test/lines.rip` counts, and types, moves, deletes and pastes
into `examples/input.rip`, holding the frame and the cursor after
every key. `test/text.rip` holds the
text engine — sanitizing, cluster widths, every wrap and truncate mode
— and `test/layout.rip` the layout engine's own pins. `test/input.rip`
holds the terminal input parser: 244 of Ink's input cases as a table
(`test/input/SOURCE.md` says which and why not the rest), every
sequence cut at every byte, its three waits on a clock moved by hand,
paste, mouse, replies, and 295,000 random bytes in random cuts that
never throw and decode the same whole or cut. `test/events.rip` holds
dispatch, focus and the cursor: 164 of Ink's focus, input-hook, cursor
and exit cases through `mount` and `run` (`test/events/SOURCE.md`), the
three phases of a dispatch in their exact order, what clears focus, the
cursor's arithmetic replayed through a terminal that keeps its cursor,
the bytes and the stdin calls of every way out of `run`, and 9,600
random steps of focus under a changing tree. `test/mouse.rip` holds the
mouse, hover, the enhanced keyboard and the selection: Ink's kitty
negotiation cases (`test/mouse/SOURCE.md`), the hit test over nested,
absolute, clipped, scrolled and hidden boxes and over words, in inline
mode and under a frame taller than the terminal, the events and their
road, the modes' bytes on every way out, the probe and both answers,
the selection's cells, overlay, damage and clipboard bytes, and a fuzz
of random trees and random cells where the hit target must be the node
the painter put there. `test/ink/static.rip` holds Ink's `Static` cases
and its `useStdout` / `useStderr` cases through `print`
(`test/ink/SOURCE.md`). `test/terminal.rip` holds every way out to one
rule — Ink's suspend, exit, error, console and CI cases
(`test/terminal/SOURCE.md`), the signals and the crash in a spawned
process, Ctrl-Z and `suspend` byte for byte, the alternate screen, a
stdout that is no terminal, the color depth, the console, and a fuzz
of keys, resizes, logs and suspends that holds the terminal's modes
to what the app believes after every step. `test/yoga.rip` runs Yoga's
543 generated layout cases, vendored unmodified under `test/yoga/`
(MIT, © Meta Platforms), against the engine through a shim of the
`yoga-layout` API. `test/yoga-aspect.rip` is a port of Yoga's 37
hand-written aspect ratio cases, and `test/yoga-hand.rip` of 53 more:
measure functions, the measure cache, measure modes, rounding a
measured size, dirtying, and computed edges.
