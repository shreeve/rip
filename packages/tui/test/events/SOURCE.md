# Ported: Ink's focus, input-hook, cursor and exit tests

- **Upstream:** [vadimdemedes/ink](https://github.com/vadimdemedes/ink)
- **Path:** `test/focus.tsx`, `test/focus-order.tsx`,
  `test/focus-empty-id-regression.tsx`, `test/hooks-use-input.tsx`,
  `test/hooks-use-input-kitty.tsx`,
  `test/hooks-use-input-navigation.tsx`, `test/hooks-use-paste.tsx`,
  `test/input-keypad-enter.tsx`, `test/input-buffered-ctrl-c.tsx`,
  `test/exit-keyboard.tsx`, `test/rerender-input.tsx`,
  `test/cursor.tsx`, `test/cursor-helpers.tsx`,
  `test/cursor-exit-position.tsx`, read from the checkout at `misc/ink`
- **Commit:** `02ae1e59e7c288e971616100c4c11bcca6b5761b` (Ink's main
  branch, ahead of the published 7.1.1) — the commit `test/ink/` and
  `test/input/` port from
- **State:** ported, not vendored. None of Ink's files is copied here;
  `ink.rip` redraws each case's tree as Rip components under Ink's own
  test title, and sends it the bytes Ink's test sends.
- **License:** MIT, © Vadym Demedes and Sindre Sorhus. The text is at
  the foot of `test/ink/SOURCE.md`.

Dispatch, focus and the cursor are written from the DOM's own model —
the capture, target and bubble phases of the DOM Standard's event
dispatch, `KeyboardEvent`'s fields, `focus()` / `blur()` /
`document.activeElement`, the `autofocus` and `disabled` attributes —
and from the xterm control-sequence reference for what is written to
the terminal (DECTCEM `CSI ? 25`, bracketed paste `CSI ? 2004`,
focus reports `CSI ? 1004`). Ink's sources were read for what its tests
mean, and none of its code is carried over: it has no event dispatch,
and its focus is a list of hook registrations.

## What runs

`rip test/events.rip` runs the ported cases and then this package's own
pins. Of Ink's 194 titles in the fourteen files, 164 are ported:

- 135 are **held** to what Ink's test asserts, under the mapping below;
- 29 are **stated differences**, pinned through `differs` in
  `harness.rip`: the answer must equal this package's stated one and
  must not equal Ink's, with the decision in a sentence, so a pin the
  package outgrows fails. They are listed below;
- 23 are left out, each with its reason, and 7 more — `cursor.tsx`'s
  `useStdout().write` and `useStderr().write` cases — are ported in
  `test/ink/static.rip`, where `print` is pinned.

`test/events.rip` holds `harness.rip`'s tally of titles to these
counts, file by file, so the table cannot drift from what runs. A case
counts once per title Ink registers, loops included.

## What is compared

Ink's tests drive a fake stdin and read three things: the last frame
written, what a `useInput` / `usePaste` handler was called with, and the
escape bytes written for the cursor. Here a case is mounted through
`mount` and sent the same bytes through `view.send`, which is the road
`run` reads stdin by; where Ink's case is about stdin or the terminal
themselves it runs through `run`, on a stdin that remembers what was
asked of it and a terminal that keeps its cursor (`harness.rip`).

| Ink | here |
|---|---|
| `useFocus({autoFocus, isActive, id})` in a component | a node with `focusable`, `autofocus`, `disabled: not isActive`, and `id` |
| `isFocused` | the node's `focused`, a reactive read through `ref:` |
| `useFocusManager()`: `focusNext`, `focusPrevious`, `focus(id)`, `activeId` | `focus.next()`, `focus.previous()`, `focus.to(node)`, `focus.active` — a node, whose `id` is read where Ink reads `activeId` |
| `disableFocus()` / `enableFocus()` | `disabled` on the box around the app: an ancestor's `disabled` is its descendants' |
| `useInput(handler)` | a `keydown` listener on a root box that holds focus (`focusable`, `autofocus`), since a key nothing focuses goes to the body; in the hook files' dispatch half, one on the document that keeps every key (`preventDefault`), so no default action runs |
| `usePaste(handler)` | a `paste` listener |
| `input`, `key.*` | the event's fields, under the mapping of `test/input/SOURCE.md` |
| `exitOnCtrlC: false` | a listener that calls `preventDefault()` on the key |
| `waitUntilExit()` | `view.done`, `running.done` |
| `rerender(<App other props />)` | a write to the mounted app's public state, and a frame |
| `useCursor().setCursorPosition({x, y})`, a place in the output | `cursor: {x, y}` on a focused node, in cells from its own corner; each port puts Ink's position on a focused box at the output's origin |
| the bytes `cursorUp(n) + cursorTo(x) + showCursor` | every frame's bytes are written to a terminal that keeps its cursor, and the terminal's cursor — where it is, whether it is shown — is held to Ink's position and to `view.cursor` |
| `incrementalRendering: true / false`, Ink's two writers | one writer; both titles run the one body |

The hook files — `hooks-use-input`, `hooks-use-input-kitty`,
`hooks-use-input-navigation`, `hooks-use-paste`, `input-keypad-enter` —
have two halves. What their bytes decode to is `test/input`'s, and
`test/input/hooks.rip` holds the rows both suites read. Here each row
is sent through a mounted app, and what its listeners hear is held to
the same events: a key is a `keydown`, a paste is a `paste`, and a focus
report, a mouse report and a reply reach neither, as none reaches Ink's
`useInput`.

## Files

| Ink test file | titles | held | stated difference | left out |
|---|---:|---:|---:|---:|
| `focus` | 47 | 40 | 5 | 2 |
| `focus-order` | 3 | 0 | 3 | 0 |
| `focus-empty-id-regression` | 3 | 3 | 0 | 0 |
| `hooks-use-input` | 34 | 27 | 6 | 1 |
| `hooks-use-input-kitty` | 24 | 23 | 1 | 0 |
| `hooks-use-input-navigation` | 18 | 14 | 4 | 0 |
| `hooks-use-paste` | 4 | 4 | 0 | 0 |
| `input-keypad-enter` | 2 | 2 | 0 | 0 |
| `input-buffered-ctrl-c` | 5 | 2 | 3 | 0 |
| `exit-keyboard` | 7 | 2 | 5 | 0 |
| `rerender-input` | 4 | 4 | 0 | 0 |
| `cursor` | 20 | 10 | 2 | 8 |
| `cursor-helpers` | 17 | 0 | 0 | 17 |
| `cursor-exit-position` | 6 | 4 | 0 | 2 |
| **total** | **194** | **135** | **29** | **30** |

## Stated differences

**Escape has no default action** (4). It is the key a dialog closes on
and a text input clears on, so what it does is the app's to say. Ink
takes focus away on every Escape.

- `focus`: focus navigation handles kitty Escape
- `focus`: focus navigation handles kitty Escape repeat
- `focus`: unfocus active component on Esc
- `focus`: activeId resets to undefined on Esc

**A key event has no field for hyper** (1), as DOM's has none, so
Hyper-Tab is Tab and moves focus. Ink reads the hyper bit and leaves
focus where it is.

- `focus`: focus navigation handles kitty Hyper+Tab

**Focus follows tree order** (1), found by a walk when Tab is pressed,
so the first node on the screen is the first Tab reaches. Ink keeps the
order its hooks registered in, which a reordered list leaves behind.

- `focus-order`: focus navigation keeps registration order after keyed reordering

**Focus belongs to a node, and an `id` is only a name** (2), so Tab
reaches every focusable node, two of one name included. Ink focuses by
id, and a second component of one id is never reached.

- `focus-order`: Tab visits a duplicated focus ID once and reaches the components after it
- `focus-order`: Tab visits a non-adjacent duplicated focus ID at its first registration

**A listener hears Ctrl-C before the default action quits** (7), since
`preventDefault` is how an app keeps the key. Ink's `exitOnCtrlC` exits
before any `useInput` handler is called, so its tests assert the handler
heard nothing. The exit itself holds in every one of them.

- `input-buffered-ctrl-c`: Ctrl+C exits when buffered with text: "\u0003"
- `input-buffered-ctrl-c`: Ctrl+C exits when buffered with text: "ab\u0003"
- `input-buffered-ctrl-c`: Ctrl+C exits when buffered with text: "\u0003ab"
- `exit-keyboard`: automatic exit handles legacy Ctrl+C
- `exit-keyboard`: automatic exit handles legacy Ctrl+C with an undefined exit option
- `exit-keyboard`: automatic exit handles kitty Ctrl+C
- `exit-keyboard`: automatic exit handles kitty Ctrl+C repeat

**Key releases are dropped** (1 here; `test/input/SOURCE.md` has the
parser's). Ink hands a release to `useInput`; here no listener hears
one, and it quits nothing in either.

- `exit-keyboard`: automatic exit handles kitty Ctrl+C release

**A paste is a `paste` event and never a key, whoever listens** (1), so
pasted text cannot be read as keystrokes. Ink hands it to `useInput` as
typed input when no `usePaste` is mounted.

- `hooks-use-input`: useInput - receives bracketed paste when no usePaste handler is active

**A cursor belongs to a node** (2), so it stays on the row of the tree
it was declared on: in a frame of six lines on a terminal of five, the
cursor declared on the third line is on the terminal's second row, with
that line. Ink counts `y` from the top of what the terminal shows, which
is another line of the output once the frame outgrows the terminal.

- `cursor`: standard rendering - fullscreen: cursor lands on the requested row on the sync path
- `cursor`: incremental rendering - fullscreen: cursor lands on the requested row on the sync path

**What the parser decodes differently** (10), each stated in
`test/input/SOURCE.md` and pinned again here for what a listener hears:
five of `hooks-use-input` (a bare `ESC [`, a carriage return and a tab
outside a paste, the Linux console's `CSI [`, `SS3 Z`), one of
`hooks-use-input-kitty` (a release), and four of
`hooks-use-input-navigation` (a doubled ESC as Meta).

## Cases left out

**React's renderer: the same trees and frames as two cases that are ported** (2)

- `focus`: focus component renders in concurrent mode
- `focus`: focus component with autoFocus renders in concurrent mode

**React's scheduler and Suspense** (2)

- `hooks-use-input`: useInput - discrete priority keeps states in sync with useTransition during rapid input
- `cursor`: cursor position does not leak from suspended concurrent render to fallback

**Writing beside the frame (`useStdout().write`, `useStderr().write`, Ink's debug writer): ported in `test/ink/static.rip`, through `print` and `print.err`** (7)

- `cursor`: cursor remains visible after useStdout().write()
- `cursor`: cursor remains visible after useStderr().write()
- `cursor`: debug mode: useStdout().write() replays latest frame
- `cursor`: debug mode: useStdout().write() does not leak into stderr
- `cursor`: debug mode: useStderr().write() replays latest frame without empty writes
- `cursor`: debug mode: useStdout().write() replays rerendered frame
- `cursor`: debug mode: useStderr().write() replays rerendered frame

**Helpers of Ink's writer with no counterpart; what they compute is held by the terminal every cursor case replays its bytes through** (17)

- `cursor-helpers`: all seventeen — `cursorPositionChanged` (5), `buildCursorSuffix` (4), `buildReturnToBottom` (3), `buildCursorOnlySequence` (2), `buildReturnToBottomPrefix` (3)

**The alternate screen: step 5 of PLAN §12** (2)

- `cursor-exit-position`: alternate-screen exit does not reposition the primary cursor (incremental: false)
- `cursor-exit-position`: alternate-screen exit does not reposition the primary cursor (incremental: true)

## Ink test files not ported

`kitty-negotiation` and the setup cases of `kitty-keyboard` are the
enhanced keyboard's probe, and `suspension-input-disable` is Ctrl-Z:
step 4c and step 5 of PLAN §12.
