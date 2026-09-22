# Rip TUI against Ink — `bun run bench`

Generated 2026-09-22 on Apple M5, 10 cores, 32 GB, darwin 27.0.0; Bun 1.4.2, Ink 7.1.1, React 19.3.0. Load average at the start: 2.28 / 3.54 / 4.74.

## Updates

A 200×60 terminal (the resize scenario starts at 120 columns). Each side of each scenario in a fresh process, 5 runs; the median and ±half the spread. Ink: `interactive: true`, incremental rendering on, React's production build, memoized rows, its frame throttle lifted (maxFps 1000), every update awaited to the write that ends its synchronized update. Rip TUI: every update flushed. Bytes and writes are per update. *Same screen*: the reducer read both sides' screens after every update, scrollback included, and they matched cell for cell — the text, and the style of every cell that is not a blank (harness.rip states the blank rule).

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

## Cold start

| | import ms | first frame ms after import | process start → frame ms |
|---|--:|--:|--:|
| Ink 7.1.1 | 39.5 | 4.5 | 70.6 |
| Rip TUI | 8.6 | 3.4 | 39.0 |

Median of 7 fresh processes each; ✓ both first frames read the same.

## Lines of code

`bun run lines` (lines.rip): non-blank, non-comment lines by test/lines.rip's rule; Ink's `src/` and Yoga's `yoga/algorithm/` against the files this package ships.

| | Ink + Yoga | Rip TUI |
|---|--:|--:|
| Framework only | Ink `src/` 6,760 | 4,252 |
| Framework + layout algorithm | + Yoga `yoga/algorithm/` 3,492 = 10,252 | 4,252 (layout.rip is 1,466 of it) |
| Full runtime closure | + React, react-reconciler, scheduler and 33 more packages (36 in all) | + Rip runtime 1,598 (reactive.js, components.js) = 5,850 |

Framework against framework, Ink is 1.6× the lines of Rip TUI; with the layout algorithm on both sides, Ink + Yoga is 2.4×. Rip TUI's files: tui.rip 311, document.rip 388, focus.rip 63, layout.rip 1,466, text.rip 421, paint.rip 701, screen.rip 173, terminal.rip 203, input.rip 315, mouse.rip 211.

## One frame, whole and damaged

`bun run frame` (frame.rip): the frame alone — paint, diff, write; the state change left out, no layout owed — owing every cell, then owing its damage; median microseconds, the bytes of one, and the cells the damaged frame painted and compared.

```
Rip TUI — one frame, 200×60, µs
  scenario                            whole p50      p99  damaged p50      p99   bytes   cells
  one cell of a 1,000-element tree         73.5     93.7          1.2      2.7      33       7
  one cell of a 200×60 table              143.3    173.1          1.0      2.4      43       4
  every cell of a 200×60 table            181.0    255.5        185.1    248.7    7962   12000
  one of 200 bordered wide panels          91.4    116.2          1.1      2.7      46       8
  a last row that comes and goes           56.4     88.1         22.8     34.3      72     200
```

## One key

`bun run keys` (keys.rip): the README's select list sent arrow keys as a terminal's bytes, from `send` to the end of the frame each causes.

```
10 items   a key that moves the choice: 5.5 µs (12 cells, 55 bytes)   a key that changes nothing: 0.2 µs
 100 items   a key that moves the choice: 41.9 µs (13 cells, 58 bytes)   a key that changes nothing: 0.1 µs
```

## One mouse report

`bun run hit` (hit.rip): a motion report, a click, and the parser alone, on a tree of 2,403 nodes.

```
nodes: 2403
motion report, same target: 0.57 µs
motion report, target changes (leave + enter): 0.59 µs
motion report, same target, with a mousemove listener: 0.71 µs
click (down, up, click, focus): 1.06 µs
parser alone: 0.13 µs
```

## Where an Ink frame goes

`bun run profile` (profile.rip): one Ink scenario under Bun's sampling profiler, every sample charged to a stage of Ink's pipeline.

```
Ink 7.1.1 — 'counter' scenario, share of in-frame CPU time
  reconcile    3.8%  ██
  layout      12.1%  ██████
  text        75.1%  ██████████████████████████████████████
  paint        8.7%  ████
  emit         0.3%  

  outside the frame: harness 1817 ms, startup 21 ms, other 35 ms
  in-frame total: 13546 ms
```

```
Ink 7.1.1 — 'table100' scenario, share of in-frame CPU time
  reconcile   12.3%  ██████
  layout      35.8%  ██████████████████
  text        45.8%  ███████████████████████
  paint        5.7%  ███
  emit         0.4%  

  outside the frame: harness 2646 ms, startup 23 ms, other 30 ms
  in-frame total: 12122 ms
```

```
Ink 7.1.1 — 'list2k' scenario, share of in-frame CPU time
  reconcile    2.4%  █
  layout      12.4%  ██████
  text        82.2%  █████████████████████████████████████████
  paint        2.8%  █
  emit         0.1%  

  outside the frame: harness 438 ms, startup 26 ms, other 39 ms
  in-frame total: 14445 ms
```

Load average at the end: 3.85 / 3.67 / 4.63.
