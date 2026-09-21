# Ported: Ink's input tests

- **Upstream:** [vadimdemedes/ink](https://github.com/vadimdemedes/ink)
- **Path:** `test/input-parser.ts`, `test/parse-keypress.ts`,
  `test/kitty-keyboard.tsx`, `test/hooks-use-input.tsx`,
  `test/hooks-use-input-kitty.tsx`,
  `test/hooks-use-input-navigation.tsx`, `test/hooks-use-paste.tsx`,
  `test/input-keypad-enter.tsx`, `test/input-buffered-ctrl-c.tsx`, read
  from the checkout at `misc/ink`
- **Commit:** `02ae1e59e7c288e971616100c4c11bcca6b5761b` (Ink's main
  branch, ahead of the published 7.1.1) — the commit `test/ink/` ports
  the paint cases from
- **State:** ported, not vendored. None of Ink's files is copied here;
  `ink.rip` writes each case as a row of a table — the bytes Ink's test
  sends, the events they decode to — under Ink's own test title.
- **License:** MIT, © Vadym Demedes and Sindre Sorhus. The text is at
  the foot of `test/ink/SOURCE.md`.

The decoder itself is written from the public references, not from
Ink's source: the xterm control-sequence reference (*ctlseqs*: "PC-Style
Function Keys", "Bracketed Paste Mode", "Extended coordinates" for SGR
mouse, "FocusIn/FocusOut", "Device Status Report", `modifyOtherKeys`),
the kitty keyboard protocol documentation ("Key codes", "Modifiers",
"Event types", "Text as code points", "Legacy functional keys",
"Functional key definitions", "Detection of support for this
protocol"), and ECMA-48 §5.4 for the shape of a control sequence.

## What runs

`rip test/input.rip` runs the ported cases and then this package's own
pins. Of Ink's 256 titles in the nine files, 244 are ported:

- 205 are **held** to Ink's answer under the mapping below;
- 39 are **stated differences**, pinned through `differs` in
  `harness.rip`: the bytes must decode to this package's stated events
  and must not decode to Ink's, with the decision in a sentence, so a
  pin the package outgrows fails. A title with one differing row is
  counted here, though its other rows hold. They are listed below;
- 12 are left out, each with its reason.

`test/input.rip` holds `harness.rip`'s tally of titles to these counts,
file by file, so the table cannot drift from what runs.

A case counts once per title Ink registers, loops included. By
registration lines, as PLAN.md counts them, the three files of the
parser are 156 (`input-parser` 52, `parse-keypress` 27,
`kitty-keyboard` 77); `input-parser`'s loop over fourteen backspace
cases makes them 169 titles, of which 131 are held.

## What is compared

Ink's tests assert in two vocabularies: its tokenizer's (a list of raw
sequences and `{paste}` objects) and its decoder's (`name`, `ctrl`,
`meta`, `shift`, and the kitty fields), and its hook tests assert what
`useInput` was handed. All three are one road here — bytes in, events
out — so every ported row feeds the bytes of Ink's test to a `Parser`
and compares the events whole. `harness.rip` maps Ink's vocabulary
once, in `ink`:

| Ink | here |
|---|---|
| `name: 'up'`, `key.upArrow` … | `key: 'ArrowUp'` … — DOM's `KeyboardEvent.key` names; `return` is `'Enter'`, `space` is `' '`, `fN` is `'FN'` |
| `ctrl`, `shift` | `ctrlKey`, `shiftKey`; a letter under shift is its capital in `key`, as DOM's is |
| `meta` from an ESC prefix, xterm's Alt bit, or kitty's alt bit | `altKey` |
| `super`, and kitty's own meta bit (32) | `metaKey` — DOM's Meta is the key kitty calls super |
| `hyper`, `capsLock`, `numLock` | no field, and no effect on any other |
| `eventType: 'repeat'` | `repeat: true` |
| `text`, `isPrintable`, `input` | a key that types is ONE code point in `key`; every other `key` is a DOM name of two or more characters. Text of several code points is one key event each |
| `name: ''` (a sequence Ink has no key for, which `useInput` drops) | no event |
| `hasPendingEscape()` | `parser.holding` is `'escape'`, `'sequence'` or `'string'` — a sequence is held that time can end; an open paste is not one in Ink, and has a patience of its own here |
| `flushPendingEscape()` | the injected clock moved past the timeout, or `parser.flush()` |
| a sequence `useInput` never sees — a focus report, a mouse report, a reply | an event of its own type (`focus`, `blur`, `mouse`, `reply`); the row holds the keys to Ink's and names the other |
| `sequence` | the bytes as they came; Ink rewrites the keypad Enter's to `'\r'` |

## Files

| Ink test file | titles | held | stated difference | left out |
|---|---:|---:|---:|---:|
| `input-parser` | 65 | 43 | 20 | 2 |
| `parse-keypress` | 27 | 22 | 3 | 2 |
| `kitty-keyboard` | 77 | 66 | 6 | 5 |
| `hooks-use-input` | 34 | 27 | 5 | 2 |
| `hooks-use-input-kitty` | 24 | 23 | 1 | 0 |
| `hooks-use-input-navigation` | 18 | 14 | 4 | 0 |
| `hooks-use-paste` | 4 | 3 | 0 | 1 |
| `input-keypad-enter` | 2 | 2 | 0 | 0 |
| `input-buffered-ctrl-c` | 5 | 5 | 0 | 0 |
| **total** | **256** | **205** | **39** | **12** |

The hook files are ported for their bytes and what those decode to. What
they assert beyond that — that raw mode and bracketed paste are switched
on and off, that Ctrl-C exits, which listener an event reaches — is the
next step's, with stdin and dispatch.

## Stated differences

**The discard rule: a sequence that holds a byte past its introducer
has a second of patience, and is then discarded, never typed** (2). Ink
has one short timeout and types whatever is held when it runs out,
which on a slow link is the tail of an arrow key.

- `input-parser`: handles pasteStart split before the tilde (\u001B[200 without ~) — Ink arms no timer for this one prefix and waits without end; here it has the patience of every sequence that holds a parameter, and the `~` that comes within it still opens the paste
- `kitty-keyboard`: kitty protocol - auto detection timeout preserves query prefix without digits

**A bare `ESC [` is Alt and `[`** (3). At the timeout, or before a byte
that cannot continue it, a bare introducer is what Alt with that key
sends, as ESC and any other character is Alt and that character. Ink
types the `[` with no modifier. (Ink's `ESC O` cases hold: it reads
Alt-O there too.)

- `input-parser`: flushes pending CSI prefix as literal input
- `input-parser`: treats invalid CSI continuation as escaped code point plus plain text — and the line feed after it is Ctrl-J, the key it is in raw mode, where Ink calls it `enter`
- `hooks-use-input`: useInput - flushes ESC[ prefix as literal input

**Dropped terminal form: rxvt's `$` and `^` finals** (3). `$` is an
intermediate byte (ECMA-48 §5.4), so `CSI 3 $` runs on to the next final
byte and is a sequence with no key: `CSI 3 $ h e l l o` decodes to the
keys `e l l o`. `CSI 2 ^`, `CSI a` and `SS3 a` are whole sequences with
no key, and decode to nothing.

- `input-parser`: keeps rxvt shifted editing keys separate from following text
- `input-parser`: emits rxvt Shift+Delete as soon as its final byte arrives
- `input-parser`: parses consecutive rxvt shifted keys including meta

**Dropped terminal form: the Linux console's and Cygwin's `CSI [ A`
function keys** (7). `[` is a final byte, so `CSI [` is a whole sequence
with no key and what follows is typed: `CSI [ A` decodes to the key
`A`, and `CSI [ 5 ~` to the keys `5` and `~`.

- `input-parser`: preserves legacy ESC[[... sequences in a mixed chunk
- `input-parser`: preserves legacy ESC[[... sequences across chunks
- `input-parser`: parses legacy and standard CSI sequences mixed together
- `input-parser`: holds incomplete legacy ESC[[... sequence until final byte arrives
- `input-parser`: parses mixed text and many key events in one read
- `input-parser`: flushes pending legacy CSI prefix as literal input
- `hooks-use-input`: useInput - drops unmapped control sequence: unmapped legacy CSI

**Dropped terminal form: a doubled ESC as Meta** (11). The first ESC,
followed by a byte that cannot continue it, is the Escape key, and the
second starts the sequence it introduces: `ESC ESC [ A` decodes to
Escape and then ArrowUp, and `ESC ESC` to Escape twice.

- `input-parser`: preserves modified SS3 keys and following text (its `ESC ESC O 5 D` row; the two others hold)
- `input-parser`: parses meta+CSI sequence with double escape
- `input-parser`: holds incomplete double-escape CSI sequence until final byte arrives
- `input-parser`: parses meta+SS3 sequence with double escape
- `input-parser`: holds incomplete double-escape SS3 sequence until final byte arrives
- `input-parser`: emits double escape as single event for non-control character
- `parse-keypress`: application keypad Enter maps to Return with carriage return sequence (its `ESC ESC O M` row; `ESC O M` holds)
- `hooks-use-input-navigation`: useInput - handle meta + up arrow
- `hooks-use-input-navigation`: useInput - handle meta + down arrow
- `hooks-use-input-navigation`: useInput - handle meta + left arrow
- `hooks-use-input-navigation`: useInput - handle meta + right arrow

**Dropped terminal form: eight-bit Meta** (1). A byte over 127 standing
for ESC and the byte less 128. Input is UTF-8, where 0xE1 opens a
three-byte character: it is held for the rest of it and decodes to
nothing alone.

- `parse-keypress`: parsing a single-byte Meta key does not mutate the input

**Key releases are dropped** (5). The package has `@keydown` and no
`@keyup`, and asks no terminal for release reports.

- `parse-keypress`: kitty modifiers and event types agree across key encodings (its release rows; press and repeat hold)
- `kitty-keyboard`: kitty protocol - backspace release
- `kitty-keyboard`: kitty protocol - event type release
- `kitty-keyboard`: kitty protocol - arrow keys with event type (its release row)
- `hooks-use-input-kitty`: useInput - handle kitty protocol release event

**A carriage return or a tab outside a bracketed paste is the key,
wherever it arrives** (4). The host turns bracketed paste on for the
app's lifetime (PLAN §8), so pasted text is a paste event; Ink keeps a
chunk that begins with one whole, for a terminal without bracketed
paste.

- `input-parser`: does not split pasted carriage return from text
- `input-parser`: does not split pasted tab from text
- `hooks-use-input`: useInput - pasted carriage return
- `hooks-use-input`: useInput - pasted tab

**One each** (3)

- `kitty-keyboard`: kitty protocol - invalid text codepoint replaced with fallback — a code point no string can hold is skipped, and the key falls back to the character of its own code; Ink types a `?` the user never pressed
- `kitty-keyboard`: kitty protocol - kp keys (57399 kp0) are non-printable — a keypad digit types its digit, as DOM's `key` for Numpad0 is `'0'`; Ink gives it no text unless the terminal reports associated text
- `hooks-use-input`: useInput - drops unmapped control sequence: unmapped modified SS3 — one table of finals serves CSI and SS3, so `SS3 1;5 Z` is the Shift-Tab `CSI 1;5 Z` is; no terminal sends it

## Cases left out

**A helper of Ink's tokenizer with no counterpart; every form it lists is a row elsewhere** (2)

- `input-parser`: isCompleteControlSequence accepts every complete CSI and SS3 form the parser emits
- `input-parser`: isCompleteControlSequence rejects partial sequences and escaped code points

**A question put to Ink's decoder that its tokenizer never puts** (1)

- `parse-keypress`: incomplete and multi-character sequences are not Meta characters — `parseKeypress('hello')` as one keypress; from a terminal those bytes are Alt-h and four keys

**The twin of a dropped form that is pinned** (1)

- `parse-keypress`: Meta byte parsing preserves shared buffers across the full byte range — eight-bit Meta, byte by byte

**Setup, teardown, and the app's lifetime: the next step's** (5)

- `kitty-keyboard`: kitty protocol - writes enable sequence on init when mode is enabled
- `kitty-keyboard`: kitty protocol - writes disable sequence on unmount
- `kitty-keyboard`: kitty protocol - not enabled when stdin is not a TTY
- `kitty-keyboard`: kitty protocol - not enabled when stdout is not a TTY
- `kitty-keyboard`: kitty protocol - auto detection does not enable protocol after unmount

**Dispatch: which listener an event reaches** (2)

- `hooks-use-input`: useInput - receives bracketed paste when no usePaste handler is active
- `hooks-use-paste`: usePaste - multiple simultaneous hooks both receive the same paste event

**React's scheduler** (1)

- `hooks-use-input`: useInput - discrete priority keeps states in sync with useTransition during rapid input

## Ink input test files not ported

`kitty-negotiation`, `rerender-input`, `exit-keyboard` and
`suspension-input-disable` drive stdin, raw mode and the app's lifetime,
which the parser has none of.
