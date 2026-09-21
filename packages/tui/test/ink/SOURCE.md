# Ported: Ink's paint-side tests

- **Upstream:** [vadimdemedes/ink](https://github.com/vadimdemedes/ink)
- **Path:** `test/*.tsx`, read from the checkout at `misc/ink`
- **Commit:** `02ae1e59e7c288e971616100c4c11bcca6b5761b` (Ink's main branch, ahead of the published 7.1.1)
- **State:** ported, not vendored. None of Ink's files is copied here;
  each `<name>.rip` redraws the trees of Ink's `test/<name>.tsx` as Rip
  components under Ink's own test titles.
- **License:** MIT, © Vadym Demedes and Sindre Sorhus. The text is at
  the foot of this file, copied from `license` at the root of the
  upstream repository.

## What is compared

`harness.rip` gives every file Ink's two widgets with Ink's defaults
(`<Box>` is a row that shrinks, `<Text>` shrinks; this package's own
widgets keep Yoga's defaults), and three reads of a frame:

- `plain` — rows of bare characters, for layout and text;
- `styled` — rows of styled cells in the notation of `cells.rip`, for
  color, background and attributes. Two renderers spell one picture
  with different escape bytes, so cells are compared and bytes never
  are;
- `tall` — the frame's height in rows, asserted wherever the rule
  below would hide blank rows at the foot of a frame.

One rule for blanks serves both sides of every comparison, and
`cells.rip` states it: a space drops the attributes it cannot show,
trailing default-style spaces are trimmed from each row, and trailing
empty rows are dropped.

## Where an expected frame comes from

Published Ink 7.1.1, installed under `packages/tui/bench`, is the
oracle. `oracle/run.ts` runs Ink's own test files against it and
records, for every frame a test reads, the frame, its width, and the
element tree that drew it, beside each assertion's actual and expected
values. Each expected literal in a ported file is one of three things,
and a comment at the literal says which when it is not the first:

1. **The frame published Ink drew**, where Ink's test compares that
   frame whole and published Ink agrees with it. This is most cases.
2. **The literal Ink's test compares against**, where published Ink
   draws something else because main is ahead of it. The comment names
   what published Ink draws. This covers every
   `contentOffsetX` / `contentOffsetY` case (`content-offset`,
   `clip-wide-background`, part of `rendering-regressions`), the
   combining-mark and wide-character overlap fixes, tab expansion,
   per-line truncation, zero-width boxes, `absolute-truncation`
   (published Ink throws on it), and four cases Ink itself marks
   `test.failing`, which state the frame Ink's authors want and no
   build of Ink draws.
3. **The frame published Ink drew, where Ink's test checks only part
   of it** (it looks for an escape code, or counts rows). The comment
   says so. Where the published frame shows a quirk and not a rule —
   the CJK truncations in `text-width` — the port asserts what Ink's
   test asserts and quotes the published frame in a comment.

`wrap-text.tsx` calls Ink's `wrapText` function and cannot load against
the published build, so `oracle/extra/wrap-text.tsx` asks the same
questions through components and `wrap-text.rip` ports that.

## Files

| Ink test file | cases | ported | left out |
|---|---:|---:|---:|
| `components` | 93 | 22 | 71 |
| `text` | 57 | 17 | 40 |
| `wrap-text` | 17 | 8 | 9 |
| `text-width` | 18 | 18 | 0 |
| `truncate-width` | 9 | 9 | 0 |
| `absolute-truncation` | 4 | 4 | 0 |
| `styled-combining-marks` | 9 | 9 | 0 |
| `borders` | 52 | 46 | 6 |
| `border-backgrounds` | 5 | 5 | 0 |
| `background` | 32 | 24 | 8 |
| `overflow` | 44 | 39 | 5 |
| `content-offset` | 23 | 23 | 0 |
| `clip-wide-background` | 10 | 10 | 0 |
| `overlap-wide-background` | 7 | 7 | 0 |
| `rendering-regressions` | 2 | 2 | 0 |
| `width-height` | 29 | 24 | 5 |
| `position` | 13 | 8 | 5 |
| `display` | 6 | 2 | 4 |
| `margin` | 15 | 12 | 3 |
| `padding` | 16 | 12 | 4 |
| `gap` | 8 | 3 | 5 |
| `flex` | 8 | 8 | 0 |
| `flex-direction` | 10 | 6 | 4 |
| `flex-wrap` | 8 | 6 | 2 |
| `flex-align-content` | 13 | 9 | 4 |
| `flex-align-items` | 9 | 9 | 0 |
| `flex-align-self` | 9 | 9 | 0 |
| `flex-justify-content` | 12 | 12 | 0 |
| `render-to-string` | 37 | 23 | 14 |
| **total** | **575** | **386** | **189** |

A case counts once per title Ink registers, loops included. Files
finished by hand after the draft: `absolute-truncation` (written by
hand), `content-offset`, `overflow`, `render-to-string`,
`styled-combining-marks`, `text-width`, `wrap-text`, and the comments in
`clip-wide-background` and `rendering-regressions`.

## Cases left out

**A rerender of a mounted tree: `renderToString` mounts a fresh tree per call** (45)

- `borders`: render border after update
- `borders`: render border edge changes after update when borderStyle is unchanged
- `background`: Box preserves child state when adding a background color
- `background`: Box preserves child state when removing a background color
- `background`: Box background updates on rerender
- `text`: text with empty-to-nonempty sibling does not wrap
- `text`: remeasure text when text is changed
- `text`: remeasure text when text nodes are changed
- `width-height`: clears maxWidth on rerender
- `width-height`: clears maxHeight on rerender
- `width-height`: clears aspectRatio on rerender
- `position`: clears top offset on rerender
- `position`: clears percentage top and left offsets on rerender
- `position`: clears percentage top and left offsets when props are omitted on rerender
- `position`: clears bottom and right offsets on rerender
- `display`: removing display="none" restores the default layout
- `display`: removing display="flex" restores the default layout
- `margin`: removing marginLeft restores marginX on rerender
- `padding`: removing paddingLeft restores paddingX on rerender
- `padding`: removing paddingX restores padding on rerender
- `gap`: removing columnGap restores gap on rerender
- `gap`: removing rowGap restores gap on rerender
- `flex-direction`: setting direction to undefined restores the default row layout
- `flex-wrap`: setting wrap to undefined restores nowrap
- `flex-wrap`: setting wrap-reverse to undefined restores nowrap
- `flex-align-content`: clears alignContent on rerender to default flex-start
- `flex-align-content`: clears alignContent from stretch on rerender to default flex-start
- `flex-align-content`: clears alignContent when prop is omitted on rerender
- `components`: remeasure text dimensions on text change
- `components`: static padding is not emitted again when there are no new items
- `components`: skip previous output when rendering new static output
- `components`: static output stops accumulating after Static unmounts (#904)
- `components`: fullStaticOutput is reset when <Static> unmounts so stale items are not replayed
- `components`: unmounting an ancestor of <Static> clears staticNode and does not crash the renderer
- `components`: removing a <Static> ancestor that is a direct child of the root does not crash
- `components`: separate Ink instances do not clobber each other’s staticNode
- `components`: updating <Static> in one instance after another instance mounted <Static> sets the dirty flag on the correct root
- `components`: unmounting a <Static> ancestor in screen-reader mode does not replay stale output
- `components`: unmounting a <Static> ancestor in concurrent mode does not crash
- `components`: remounting <Static> via key change emits the new items (nested under <Box>)
- `components`: remounting <Static> via key change emits the new items (root-level — removeChildFromContainer)
- `components`: render only new items in static output on final render
- `components`: replace child node with text
- `components`: reset prop when it’s removed from the element
- `wrap-text`: changing text wrapping recalculates the container height

**Concurrent rendering: the `- concurrent` twin of a case that is ported** (45)

`borders` 4, `background` 4, `overflow` 4, `text` 8, `width-height` 2, `position` 1, `display` 2, `margin` 2, `padding` 2, `gap` 3, `flex-direction` 2, `flex-align-content` 1, `components` 10

**`<Static>`** (7)

- `background`: Static background color is inherited by its text
- `render-to-string`: skip Static content inside a hidden ancestor
- `render-to-string`: render Static component with items
- `render-to-string`: Static preserves its margins and all items
- `render-to-string`: render static-only output has no trailing newline
- `render-to-string`: render static + dynamic output has exactly one newline between parts
- `components`: static output

**`<Transform>`** (10)

- `overflow`: vertical clipping preserves Transform line indices
- `render-to-string`: render Transform component
- `components`: transform children
- `components`: squash multiple text nodes
- `components`: transform with multiple lines
- `components`: squash multiple nested text nodes
- `components`: squash empty `<Text>` nodes
- `components`: <Transform> with undefined children
- `components`: <Transform> with null children
- `render-to-string`: runs effect cleanup when a transform throws

**An escape or control sequence embedded in text** (39)

- `text`: strip ANSI cursor movement sequences from text
- `text`: strip ANSI cursor position and erase sequences from text
- `text`: preserve SGR color sequences in text
- `text`: preserve OSC hyperlink sequences in text
- `text`: preserve OSC hyperlink sequences with ST terminator in text
- `text`: preserve C1 OSC sequences in text
- `text`: preserve C1 OSC hyperlink sequences with ST terminator in text
- `text`: preserve colors encoded with colon parameters
- `text`: strip complete non-SGR CSI sequences without leaking parameters
- `text`: strip complete C1 non-SGR CSI sequences without leaking parameters
- `text`: strip complete ESC control sequences with intermediates
- `text`: strip tmux DCS passthrough wrappers without leaking payload
- `text`: strip tmux DCS passthrough wrappers with ST-terminated OSC payload
- `text`: strip C1 DCS control strings as complete units
- `text`: strip PM and APC control strings as complete units
- `text`: strip C1 PM and APC control strings as complete units
- `text`: strip ESC SOS control strings as complete units
- `text`: strip C1 SOS control strings as complete units
- `text`: strip malformed SOS control strings to avoid payload leaks
- `text`: preserve SGR sequences around stripped SOS control strings
- `text`: strip tmux DCS passthrough containing BEL until the final ST terminator
- `text`: strip incomplete DCS passthrough sequences to avoid payload leaks
- `text`: strip incomplete C1 DCS control strings to avoid payload leaks
- `text`: strip incomplete OSC control strings to avoid payload leaks
- `text`: strip incomplete C1 OSC control strings to avoid payload leaks
- `text`: strip incomplete ESC control sequences with intermediates to avoid payload leaks
- `text`: strip malformed ESC control sequences with intermediates and non-final bytes
- `text`: strip standalone ST bytes from text output
- `text`: strip standalone C1 control characters from text output
- `components`: do not wrap text with BEL-terminated OSC hyperlinks
- `components`: do not wrap text with ST-terminated OSC hyperlinks
- `components`: do not wrap text with non-hyperlink OSC sequences
- `components`: hard-wrap single-word BEL-terminated OSC hyperlink
- `components`: hard-wrap single-word ST-terminated OSC hyperlink
- `components`: link ansi escapes are closed properly
- `wrap-text`: truncated multi-line text keeps a C1 SGR color that spans a newline
- `wrap-text`: truncated multi-line text keeps a C1 OSC hyperlink that spans a newline
- `wrap-text`: truncated multi-line text keeps a colon 256-color that spans a newline
- `wrap-text`: truncated multi-line text keeps a colon truecolor that spans a newline

**Screen-reader output** (1)

- `flex-direction`: undefined direction uses row separators for screen readers

**Hooks or an error boundary** (9)

- `render-to-string`: captures initial render output before effect-driven state updates
- `render-to-string`: useLayoutEffect state updates are reflected in output
- `render-to-string`: runs effect cleanup on teardown
- `render-to-string`: component that throws undefined does not silently return empty output
- `components`: fail when text nodes are not within <Text> component
- `components`: fail when text node is not within <Text> component
- `components`: fail when <Box> is inside <Text> component
- `components`: hooks
- `render-to-string`: preserves component errors from another realm

**A deliberate difference: bare text under a box is a text leaf in this package** (1)

- `render-to-string`: text outside Text component throws

**Input, the app lifecycle, the alternate screen, or CI output: no frame to compare** (27)

- `components`: disable raw mode when all input components are unmounted
- `components`: do not disable raw mode when swapping components that use useInput
- `components`: clear pending input parser state when swapping components that use useInput
- `components`: re-ref stdin when input is used after previous unmount
- `components`: setRawMode() should throw if raw mode is not supported
- `components`: render different component based on whether stdin is a TTY or not
- `components`: render only last frame when run in CI
- `components`: render all frames if CI environment variable equals false
- `components`: debug mode in CI does not replay final frame during unmount teardown
- `components`: debug mode in CI keeps final newline separation after waitUntilExit
- `components`: render only last frame when stdout is not a TTY
- `components`: render all frames when interactive is explicitly true
- `components`: interactive option overrides TTY detection
- `components`: alternate screen - enters on mount and exits on unmount
- `components`: primary screen - cleanup console output follows the native console during unmount
- `components`: alternate screen - does not replay exit(Error) output on the primary screen during unmount
- `components`: alternate screen - does not replay teardown output on the primary screen during unmount
- `components`: alternate screen - cleanup console output follows the native console during unmount
- `components`: alternate screen - cleanup() exits the alternate screen
- `components`: alternate screen - debug concurrent teardown restores the cursor before the first commit
- `components`: render warns when stdout is reused before unmount
- `components`: alternate screen - ignored when non-interactive
- `components`: alternate screen - disabled by default
- `components`: alternate screen - content is rendered between enter and exit
- `components`: alternate screen - ignored when isTTY is false
- `components`: alternate screen - ignored when isTTY is false even if interactive is true
- `components`: static output is written immediately in non-interactive mode

**An empty `render` block has no spelling in Rip** (1)

- `render-to-string`: render empty fragment

**A call of `wrapText` at a width no tree reaches (zero, negative, a fraction); width-height.tsx covers those boxes** (3)

- `wrap-text`: keeps text at its natural width when there is no room to wrap
- `wrap-text`: wraps a fraction of a column like one column
- `wrap-text`: leaves truncation at zero columns alone

**The internals of Ink's wrap cache** (1)

- `wrap-text`: evicts old cached results

## Ink test files not ported

- **Input, focus, hooks, the cursor, and the kitty keyboard protocol:** `cursor`, `cursor-exit-position`, `cursor-helpers`, `focus`, `focus-empty-id-regression`, `focus-order`, `focus-strict-mode`, `hooks`, `hooks-use-input`, `hooks-use-input-kitty`, `hooks-use-input-navigation`, `hooks-use-paste`, `input-buffered-ctrl-c`, `input-keypad-enter`, `input-parser`, `kitty-keyboard`, `kitty-negotiation`, `parse-keypress`, `rerender-input`, `use-animation`.
- **The app lifecycle, the terminal, and log-update internals:** `alternate-screen-example`, `clear-rerender`, `exit`, `exit-keyboard`, `log-update`, `log-update-blank-growth`, `render`, `render-callback`, `suspend-terminal`, `suspension-exit`, `suspension-handle`, `suspension-input-disable`, `suspension-output`, `suspension-resize`, `terminal-resize`, `write-synchronized`.
- **Escape and control sequences embedded in text:** `ansi-newlines`, `ansi-tokenizer`, `c1-rendering`, `colon-colors`, `sanitize-ansi`, `text-controls`.
- **`<Static>` and `<Transform>`:** `component-regressions`, `issue-973-static-commit`, `squash-text-nodes`, `static-abandoned-render`, `static-blank-lines`, `static-runtime-blank-lines`, `static-string-replacement`, `static-trailing-layout`.
- **Error boundaries, Suspense, the reconciler, and rerenders:** `error-overview`, `errors`, `reconciler`, `style-update-consistency`, `styles`.
- **measureElement, useBoxMetrics, and Ink's `measureText` function:** `measure-element`, `measure-text`, `use-box-metrics`.
- **Screen-reader output:** `screen-reader`.
- **Ink's own build, color parser, and tooling:** `build-output`, `colorize`, `is-devtools-reachable`.

## Regenerating

The oracle needs the Ink checkout at `misc/ink` and the bench install
(`cd packages/tui/bench && bun install`). Nothing under `oracle/` is a
test, and `test/ink.rip` imports none of it.

```bash
cd packages/tui/bench
bun ../test/ink/oracle/run.ts borders text        # any of the files above
cd ..
rip test/ink/oracle/draft.rip borders | diff - test/ink/borders.rip
```

`run.ts` writes `oracle/out/<name>.json` (ignored by git). It runs
React's development build — leave `NODE_ENV` unset — because Ink's
async test helpers need `act`, and it forces colors on so the recorded
frames carry their SGR sequences. `draft.rip` turns a record into a
ported file: each recorded tree as a Rip component, each expectation
through `cells.rip`, the cases it leaves out on stderr with the reason.
For a file the draft produced whole, the diff is empty until Ink or the
oracle changes, and a changed literal is pasted from the draft. For a
file finished by hand, the diff shows the hand-finished tests beside
any change.

## Ink's license

```
MIT License

Copyright (c) Vadym Demedes <vadimdemedes@hey.com> (https://github.com/vadimdemedes)
Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
