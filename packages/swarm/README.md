<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Swarm

> **Parallel job runner with worker threads — setup once, swarm many.**

Swarm is a high-performance batch job engine for Rip. Give it a list of
tasks and a function to process each one, and it fans out across worker
threads with real-time progress bars, automatic retries, and a clean
summary when done. No database, no message broker, no dependencies —
just files, threads, and message passing.

**Runtime:** not browser-safe — it spawns worker threads and moves
files. One `.rip` file, which is itself the `swarm` binary (first line
`#!/usr/bin/env rip`) and its own worker entry.

## Features

- **Tasks are files** — a directory listing *is* the queue; inspect,
  add, or remove tasks with basic shell commands
- **State is a file move** — `todo/ → done/` is one atomic rename;
  crash-safe restarts pick up where they left off
- **Workers are threads** — setup runs once, context clones to N
  workers by message passing; no shared mutable state
- **Real-time progress** — a bar per worker showing how far along the
  run is and who is doing the work, an overall bar, and per-worker stats
  at the end (or `-q` for one summary line)
- **Retries built in** — failed tasks land in `died/`; `retry()` moves
  them back and only they reprocess
- **Crash recovery** — a dead worker's in-flight task is counted,
  logged, and the worker respawns

## Why This Approach?

Most job queues add complexity: Redis, RabbitMQ, database-backed queues,
distributed locks. Swarm takes the opposite approach:

- **Tasks are files.** A directory listing *is* the queue. You can
  inspect, add, or remove tasks with basic shell commands.
- **State is a file move.** `todo/ → done/` is one atomic `rename`.
  No transactions, no eventual consistency. If the process crashes,
  unfinished tasks are still in `todo/` — restart and pick up where
  you left off.
- **Workers are threads.** Setup runs once in the main thread, context
  is cloned to N workers via message passing. No shared mutable state,
  no locks, no deadlocks.
- **Progress is real-time.** The main thread owns the terminal — ANSI
  progress bars update live with per-worker stats. Workers never touch
  stdout.

The result: ~530 lines of Rip, zero dependencies, and it handles
thousands of tasks reliably. Boring infrastructure, rock solid.

## Quick Start

Create a job script:

```coffee
import { swarm, init, retry, todo } from 'rip/swarm'

setup = ->
  unless retry()
    init()
    for i in [1..100] then todo(i)
  { startedAt: Date.now() }

perform = (task, ctx) ->
  Bun.sleep! Math.random() * 1000
  raise 'boom' if Math.random() < 0.03

swarm! { setup, perform }
```

Run it:

```bash
swarm jobs.rip              # workers default to CPU count
swarm jobs.rip -w 10        # 10 workers
swarm jobs.rip -w 40        # 40 workers for I/O-heavy jobs
```

There is no wrapper script: `swarm.rip` is itself the `swarm` binary
(first line `#!/usr/bin/env rip`), so the command works wherever `rip`
is installed. `rip jobs.rip` runs the same script identically — the
`swarm` command adds the from-anywhere name and a usage message.

## How It Works

```
┌──────────────────────────────────────────────────┐
│                Single Bun Process                │
│                                                  │
│  Main Thread              Worker Threads (N)     │
│  ──────────              ──────────────────      │
│  setup() runs once        each loads your script │
│  creates .swarm/todo/*    receives tasks via IPC │
│  dispatches tasks         calls perform(task)    │
│  renders progress bars    reports done/failed    │
│  moves files atomically   stays alive for more   │
│                                                  │
│  .swarm/todo/42 ──rename──→ .swarm/done/42       │
│                 ──rename──→ .swarm/died/42       │
└──────────────────────────────────────────────────┘
```

1. **`setup()`** runs once in the main thread — creates task files and
   returns an optional context object (auth tokens, config, paths).
   **Important:** the context must be plain data (strings, numbers,
   booleans, arrays, plain objects). Class instances, functions, HTTP
   clients, sockets, and other complex objects cannot be cloned for
   worker threads — use `fetch` inside `perform()` instead
2. **N worker threads** are spawned — each loads your script and gets
   the `perform` function. Workers are long-lived and process many tasks
3. Tasks are dispatched from `.swarm/todo/` to workers via message passing
4. Workers call `perform(task, ctx)` — on success the file moves to
   `done/`, on failure it moves to `died/`
5. The main thread draws the progress display as tasks finish (see
   [The Progress Display](#the-progress-display))
6. If tasks died, just run it again — `retry()` moves them back to
   `todo/` and only those tasks are reprocessed

## The Progress Display

The end of a real run, 4,045 tasks across 10 workers:

```
    ╭──────────────────────╮
  1 │ ••••                 │ 151 jobs @ 13.1/sec
  2 │ ••••••••••••••       │ 499 jobs @ 43.4/sec
  3 │ •••••••••••••••••••• │ 692 jobs @ 60.2/sec
  4 │ •••••••••            │ 312 jobs @ 27.1/sec
  5 │ ••••••••••••••••••   │ 633 jobs @ 55.0/sec
  6 │ ••••                 │ 139 jobs @ 12.1/sec
  7 │ •••••••••••          │ 397 jobs @ 34.5/sec
  8 │ ••••••••••••         │ 441 jobs @ 38.3/sec
  9 │ •••••••••••••••••    │ 595 jobs @ 51.7/sec
 10 │ •••••                │ 186 jobs @ 16.2/sec
    ├──────────────────────┤
    │ •••••••••••••••••••• │  100.0%  4045/4045 done
    ╰──────────────────────╯

11.50 secs for 4045 jobs by 10 workers @ 351.74 jobs/sec
```

**Worker bars** answer two questions at once: how far along is the run,
and who is doing the work.

- **While the run is live,** a bar is the run's progress times the
  worker's share of the busiest worker's jobs. The busiest worker's bar
  *is* the run's progress; every other bar is its share of that. Beside
  each row is the task that worker is on.
- **Bars never step back** while the run is live. When the leader pulls
  ahead, a worker's true share shrinks, and a bar losing ground reads as a
  drawing error, so each bar holds its widest until its own work carries
  it past. Pass `hold: false` to draw every bar at its true value.
- **A worker that has done any work shows at least one cell,** so a row
  is empty only for a worker that has finished nothing.
- **At the end,** the busiest worker's bar is exactly full and every
  other bar is its true share of the busiest worker's jobs, with its job
  count and rate beside it. A jagged edge is normal: it shows how
  unevenly the work fell, and workers tied for the most are all full.

**The overall bar** says when the run is done: green for done, yellow
for in flight, red for the rest — pending, and at the end the tasks that
died. The three always fill its width. The percentage rounds down, so it
reads `100.0%` only when every task has finished.

**Drawing** happens ten times a second, and only when something changed;
a terminal resize redraws on the next tick. Only the main thread draws
it. `-q` replaces it with the one summary line.

## Task Lifecycle

```
.swarm/
├── todo/       ← tasks waiting to be processed
├── done/       ← completed successfully
└── died/       ← failed (retryable)
```

One queue per working directory, shared by every swarm script run
there. A script that runs beside others names its own with a tag —
`swarm! { tag: 'reports' }` or `-t reports` — and its queue lives under
`.swarm/reports/` instead, so a day one script leaves in `died/` is
never replayed by another.

Tasks are plain files. The filename identifies the task (e.g., `000315`,
`2024-01-15`, `amazon.json`). Files can be empty (filename is the data)
or contain a payload that `perform` reads. File moves use `renameSync`
— atomic on the same filesystem, no partial states.

## API

### Task Queue

```coffee
import { init, retry, todo } from 'rip/swarm'

init()               # Remove old .swarm, create todo/done/died dirs
retry()              # Move .swarm/died/* back to .swarm/todo/ for retry
todo('task-1')       # Create empty task file
todo('task-2', data) # Create task file with data (string or JSON)
```

### swarm()

```coffee
swarm! { setup, perform }
swarm! { setup, perform, workers: 8, bar: 30, char: '█' }
swarm! { setup, perform, tag: 'reports' }
```

Write it with the `!` so the script waits on it. Every worker loads your
script to find `perform`, and a worker stops at `swarm!`: code before it
(imports, definitions) runs in each worker as well, and code after it
runs once, in the main thread, when the run is over. Without the `!` the
script does not wait, so code after the call runs at once, in the main
thread and in every worker.

| Option | Description | Default |
|--------|-------------|---------|
| **setup** | Runs once in main thread, returns optional context | — |
| **perform** | `(taskPath, ctx)` — runs in worker threads | required |
| **workers** | Number of worker threads | CPU count |
| **bar** | Progress bar width in characters | 20 |
| **char** | Character for progress bars | `•` |
| **tag** | Name of this script's queue, kept under `.swarm/<tag>/` | none — `.swarm/` |
| **hold** | Worker bars only move forward while the run is live; a clear off (`false`, `0`, `'no'`, `'off'`, any case) draws each at its true value, so a worker falling behind steps back | `true` |

### CLI Flags

```
-w, --workers <n>     Number of workers (default: CPU count)
-b, --bar <width>     Progress bar width (default: 20)
-c, --char <ch>       Bar character (default: •)
-t, --tag <name>      Keep the queue under .swarm/<name> (default: .swarm)
-r, --reset           Remove the queue directory and quit
-s, --safe            Set safe: true on the worker context
-q, --quiet           No progress display, one summary line
-h, --help            Show help (bare `swarm` command only)
-v, --version         Show version (bare `swarm` command only)
```

CLI flags override options passed to `swarm()`. The version is read
from package.json at runtime, so it can never drift.

### args()

Swarm also exports `args()` which returns `process.argv` with all
swarm flags stripped — only your script's positional arguments remain:

```coffee
import { swarm, args } from 'rip/swarm'

inputFile = args()[0]    # first non-swarm argument
```

## Crash Recovery

| Failure | What Happens | Recovery |
|---------|-------------|----------|
| `perform()` throws | Worker catches it, reports failed, picks up next task | Automatic |
| Unhandled rejection | Worker error handler fires, continues | Automatic |
| Worker thread dies | Main thread detects exit, respawns worker | Automatic |
| Process killed (Ctrl+C) | Unfinished tasks remain in `todo/`, cursor restored | Re-run to continue |

Failed tasks land in `.swarm/died/` and their errors append to
`.swarm/errors.log`. Call `retry()` in your next `setup()` to move them
back for reprocessing — only the failed tasks run, not the entire batch.

## Real-World Example

Downloading 15,000 lab test definitions from an API with 40 workers:

```coffee
import { swarm, args, init, retry, todo } from 'rip/swarm'
import { isMainThread } from 'worker_threads'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

TESTS_FILE = null
if isMainThread
  TESTS_FILE = args()[0]

setup = ->
  unless retry()
    init()
    lines = readFileSync(TESTS_FILE, 'utf-8').trim().split('\n')
    for code in lines then todo(code.trim()) if code.trim()
  outDir = resolve('../data/tests')
  mkdirSync(outDir, { recursive: true })
  auth = readFileSync(resolve('.auth'), 'utf-8')
  xibm = auth.match(/^X-IBM-Client-Id=(.*)$/m)?[1]
  cook = auth.match(/^lch-authorization_ACC=.*$/m)?[0]
  { xibm, cook, outDir }

perform = (task, ctx) ->
  code = task.split('/').pop()
  return if existsSync(join(ctx.outDir, "#{code}.json"))
  resp = fetch! "https://api.example.com/tests/#{code}",
    method: 'POST'
    headers: { 'Cookie': ctx.cook }
    body: JSON.stringify { testCode: code }
  raise "HTTP #{resp.status}" unless resp.ok
  Bun.write! join(ctx.outDir, "#{code}.json"), resp.text!

swarm! { setup, perform }
```

```bash
rip download-tests.rip tests.txt -w 40
# 15,000 tests across 40 workers — finishes in minutes
```

## Troubleshooting

### Progress bar text appears black in VS Code / Cursor

VS Code's terminal has a "minimum contrast ratio" feature that overrides
foreground colors. This can turn white progress text black. To fix it,
add this to your VS Code or Cursor settings:

```json
"terminal.integrated.minimumContrastRatio": 1
```

This disables the contrast adjustment and lets ANSI colors render as
intended. The progress display works correctly in standard terminals
(iTerm2, Terminal.app, etc.) without any changes.

## Test

```bash
bun run test
```

The suite pins batch runs across workers (context cloning, failures,
retries, crash recovery), every CLI flag and error path, the progress
display (bar arithmetic, holding, the last frame, the overall bar, the
draw timer, resizes), what runs where around `swarm!`, `args()`
stripping, the file-based queue contract line for line, and the `swarm`
command itself — each case running the fixtures/ job scripts as real
subprocesses.
