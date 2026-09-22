# Ported: Ink's kitty keyboard negotiation tests

- **Upstream:** [vadimdemedes/ink](https://github.com/vadimdemedes/ink)
- **Path:** `test/kitty-negotiation.tsx`, and the two negotiation rows
  of `test/kitty-keyboard.tsx`, read from the checkout at `misc/ink`
- **Commit:** `02ae1e59e7c288e971616100c4c11bcca6b5761b` (Ink's main
  branch, ahead of the published 7.1.1) — the commit `test/ink/`,
  `test/input/` and `test/events/` port from
- **State:** ported, not vendored. None of Ink's files is copied here;
  `test/mouse.rip` redraws each case as a Rip component under Ink's own
  test title and sends it the bytes Ink's test sends.
- **License:** MIT, © Vadym Demedes and Sindre Sorhus. The text is at
  the foot of `test/ink/SOURCE.md`.

The negotiation is written from the kitty keyboard protocol
documentation ("Detection of support", "Progressive enhancement": the
query `CSI ? u`, the push `CSI > flags u`, the pop `CSI < u`) and the
xterm control-sequence reference (primary device attributes `CSI c`,
DECXCPR `CSI ? 6 n`, the mouse modes 1002, 1003 and 1006, OSC 52).
Ink's sources were read for what its tests mean; its `kitty-keyboard.ts`
is a table of flag names and a timer, and none of it is carried over.

## What runs

Of the five titles in `kitty-negotiation.tsx`, two are ported and
three are left out; of `kitty-keyboard.tsx`'s two negotiation titles,
both are ported. `test/mouse.rip` holds `harness.rip`'s tally to these
counts.

| Ink file | titles | held | differs | left out |
|---|---|---|---|---|
| `kitty-negotiation` | 5 | 1 | 1 | 3 |
| `kitty-keyboard` (negotiation rows) | 2 | 1 | 1 | 0 |

## What is compared

Ink's `kittyKeyboard: { mode: 'auto' }` is `keyboard: 'enhanced'` here:
both send `CSI ? u` and enable the protocol on a reply through the
ordinary input road, so a reply is never read twice or typed. Ink waits
200 ms for the reply; this package sends the primary device attributes
query right after, and whichever reply comes first decides, so no
timer is involved (PLAN §7). Ink's `mode: 'enabled'` has no
counterpart: the flag is pushed only when the terminal has said it
speaks the protocol.

## Held

- `kitty-negotiation`: auto detection consumes responses without
  duplicating input
- `kitty-keyboard`: writes disable sequence on unmount — after the
  terminal's answer, `CSI < u` is written before the modes are
  withdrawn

## Stated differences

- `kitty-negotiation`: pasted query responses remain input and do not
  enable the protocol — the protocol stays off, as in Ink; the paste is
  one `paste` event with its text as it came, ESC included, where Ink
  types it as keys with the ESC dropped
- `kitty-keyboard`: writes enable sequence on init when mode is enabled
  — `CSI > 1 u` is written when the terminal answers the query, never
  on trust, so a terminal that does not answer is never pushed to

## Left out

- `kitty-negotiation`: associated text requests include all-key
  reporting — a table of flag names; the package asks for the
  disambiguation flag and no other (PLAN §7)
- `kitty-negotiation`: suspension cancels pending keyboard negotiation
  — `suspend` is the lifecycle's (PLAN §8, step 5)
- `kitty-negotiation`: unmount while suspended does not pop the
  primary keyboard stack — the same
