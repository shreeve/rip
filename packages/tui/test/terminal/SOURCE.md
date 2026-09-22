# Ported: Ink's suspend, exit, error, console and CI tests

- **Upstream:** [vadimdemedes/ink](https://github.com/vadimdemedes/ink)
- **Path:** `test/suspend-terminal.tsx`, `test/suspension-exit.tsx`,
  `test/suspension-output.tsx`, `test/suspension-resize.tsx`,
  `test/suspension-handle.tsx`, `test/suspension-input-disable.tsx`,
  the two suspension rows of `test/kitty-negotiation.tsx`,
  `test/exit.tsx`, `test/errors.tsx`, `test/error-overview.tsx`,
  `test/alternate-screen-example.tsx`, the console rows of
  `test/render.tsx` and the CI rows of `test/components.tsx`, read
  from the checkout at `misc/ink`
- **Commit:** `02ae1e59e7c288e971616100c4c11bcca6b5761b` (Ink's main
  branch, ahead of the published 7.1.1) — the commit `test/ink/`,
  `test/input/`, `test/events/` and `test/mouse/` port from
- **State:** ported, not vendored. None of Ink's files is copied here;
  `test/terminal.rip` redraws each case as a Rip component under Ink's
  own test title and takes the way out Ink's test takes.
- **License:** MIT, © Vadym Demedes and Sindre Sorhus. The text is at
  the foot of `test/ink/SOURCE.md`.

The lifecycle is written from the xterm control-sequence reference
(DECTCEM `CSI ? 25`, bracketed paste `CSI ? 2004`, focus reports
`CSI ? 1004`, the mouse modes, the alternate screen `CSI ? 1049`,
DECXCPR `CSI ? 6 n`), the kitty keyboard protocol's push and pop, the
POSIX meaning of SIGTSTP and SIGCONT, and Bun's and Node's `process`
documentation for signals, `uncaughtException`, `beforeExit` and
`exit`. Ink's `ink.tsx`, `log-update.ts` and `App.tsx` were read for
what its tests mean; its ref-counted raw mode, its console patch and
its throttled log-update are not carried over.

## What runs

Of the 70 titles in these files, 27 are held, 1 differs, and 42 are
left out. A title is counted once per case Ink registers, so a `test(`
site inside a loop counts once per turn of the loop; both columns are
given. `test/terminal.rip` holds `harness.rip`'s tally to these counts.

| Ink file | sites | titles | held | differs | left out |
|---|---|---|---|---|---|
| `suspend-terminal` | 11 | 14 | 8 | 0 | 6 |
| `suspension-exit` | 1 | 2 | 1 | 0 | 1 |
| `suspension-output` | 2 | 3 | 1 | 0 | 2 |
| `suspension-resize` | 1 | 2 | 2 | 0 | 0 |
| `suspension-handle` | 1 | 2 | 0 | 0 | 2 |
| `suspension-input-disable` | 6 | 7 | 0 | 0 | 7 |
| `kitty-negotiation` (suspension rows) | 2 | 2 | 1 | 1 | 0 |
| `exit` | 15 | 15 | 9 | 0 | 6 |
| `errors` | 8 | 8 | 1 | 0 | 7 |
| `error-overview` | 7 | 7 | 0 | 0 | 7 |
| `alternate-screen-example` | 2 | 2 | 0 | 0 | 2 |
| `render` (console rows) | 1 | 2 | 2 | 0 | 0 |
| `components` (CI rows) | 4 | 4 | 2 | 0 | 2 |

The suspension rows of `kitty-negotiation` were left out of
`test/mouse/SOURCE.md` for this file; `waitUntilExit preserves the
original component error` is pinned in `test/events.rip` and left out
here.

## What is compared

Ink's `useApp().suspendTerminal(fn)` is `suspend fn` here: both give
the terminal back, run `fn`, and take it again with a whole redraw.
Ink's `unmount()` and `exit(value)` are both `quit value`; its
`waitUntilExit()` is `done`; its `patchConsole` option is `console`;
its `interactive: false` is a stdout that is no terminal, or `CI`
set. A case Ink runs on a pty runs here in a spawned `rip` process
whose stdout says it is a terminal and writes through to the pipe
(`test/terminal/child.rip`), so the bytes are read as a pty would show
them and the exit code is the process's own.

| Ink | here |
|---|---|
| `suspendTerminal(async () => …)` | `suspend! -> …` |
| `stdin.setRawMode` calls | `Stdin.calls` (`harness.rip`) |
| `stdout.getWrites()` | `Terminal.sent`, `Terminal.since` |
| `[?25h` / `[?25l` in a write | the same bytes |
| `[?1049h` / `[?1049l` | the same bytes; `CSI H` follows the entry |
| `alternateScreen: true` | `altScreen: true` |
| `interactive: false` | `stdout` with no `isTTY`, or `CI` set |
| `patchConsole: false` | `console: false` |
| `process.exit`, a fixture's exit code | `Child.finish` in a spawned process |

## Held

- `suspend-terminal`: hands the terminal to the callback, then
  restores Ink; restores the terminal even if the callback throws;
  keeps Ink off the terminal while suspended; runs the callback but
  skips the handoff when not interactive; rejects a nested suspend
  while already suspended; hands the terminal to a child process, then
  redraws (PTY) — the "child" writes to the same fake terminal, and
  the frame is drawn again below what it wrote; exits and re-enters
  the alternate screen; rolls back so a later suspend works if
  handover throws
- `suspension-exit`: resuming after unmount does not re-enable
  terminal input (callback: true)
- `suspension-output`: non-interactive suspension keeps the latest
  rendered frame
- `suspension-resize`: resize to 80 / 120 columns does not write while
  suspended
- `kitty-negotiation`: unmount while suspended does not pop the primary
  keyboard stack
- `exit`: exit normally without unmount() or exit(); exit when app
  finishes execution — both by the same spawned process, whose loop
  drains and whose app is closed on `beforeExit`; exit on unmount();
  exit on exit(); exit on exit() with raw mode; exit on unmount() with
  raw mode — raw mode is always on here, so the four are one `quit`;
  exit on exit() with result value; exit on exit() with object result;
  exit with thrown error — `run` throws it
- `errors`: clean up raw mode when error is thrown — an uncaught error
  in a spawned process, which leaves the modes withdrawn and exits 1
- `render`: intercept console methods with omitted / undefined
  patchConsole option
- `components`: render only last frame when run in CI; render all
  frames if CI environment variable equals false

## Stated differences

- `kitty-negotiation`: suspension cancels pending keyboard negotiation
  — an answer that arrives while suspended reaches nobody, as in Ink;
  but the question is asked again on resume, so a terminal that
  answers it then is pushed to, where Ink cancels the negotiation for
  the rest of the run

## Left out

- `suspend-terminal`: returns a disposable that resumes on resume();
  disposable resumes via Symbol.asyncDispose — `suspend` takes the
  function to run and resumes when it settles; there is no handle
- `suspend-terminal`: shows `<Static>` output once after resume
  re-enters the alternate screen (four modes) — `Static` is a
  documented no-op on the alternate screen (PLAN §6)
- `suspension-exit`: callback: false — a handle
- `suspension-output`: non-interactive suspension preserves stdout /
  stderr writes — Ink's `useStdout().write`; a write to a stream is
  the stream's own here
- `suspension-handle`: both — handles
- `suspension-input-disable`: all seven — Ink's input hooks each own a
  share of raw mode and of bracketed paste, and a resume restores the
  shares that still have an owner; the host owns the terminal for the
  app's life here, with no share to disable (PLAN §8)
- `exit`: exit on exit() with error; with error with value property;
  with raw mode with error — `quit` takes a result and never an error;
  an app that fails throws, and `done` rejects with what it threw
  (`test/events.rip`)
- `exit`: don't exit while raw mode is active — the process is kept
  alive by a real stdin's `ref`, which a fake stdin has no way to show
- `exit`: exit when DEV is set — React's development flag
- `exit`: exit on exit() with error and static output — `Static`, and
  an error result
- `errors`: catch and display error; ErrorBoundary catches and
  displays nested component errors — the error overview is a deferred
  reporter (PLAN §13); display thrown strings and reject waitUntilExit;
  display thrown undefined — the same; does not emit unhandledRejection
  when render exits with an error and waitUntilExit is unused — `done`
  is always handed back, and a rejection nobody awaits is the caller's;
  waitUntilExit preserves the original component error —
  `test/events.rip` pins that `done` rejects with what a listener threw;
  waitUntilExit preserves a component error from another realm — a
  `vm` context; an error is whatever object was thrown here
- `error-overview`: all seven, "does not emit duplicate key warnings
  for repeated stack lines" among them — the deferred reporter; stacks
  are the runtime's own (`src/cli/run.js`)
- `alternate-screen-example`: both — the snake game's reducer, and a
  fixture that prints its state; the alternate screen's bytes and the
  leave order are pinned by this package's own rows ("The alternate
  screen" in `test/terminal.rip`)
- `components`: debug mode in CI does not replay final frame during
  unmount teardown; debug mode in CI keeps final newline separation
  after waitUntilExit — Ink's
  `debug` option, which writes every frame whole, has no counterpart
