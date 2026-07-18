<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Stamp - @rip-lang/stamp

> **Declarative host provisioning — no state file, no agent, no YAML.**

Stamp reads a Stampfile, turns each top-level entry into a directive, and
resolves the directive's type to a handler — a small `.rip` file exporting
`check`, `apply`, and `verify`. Every handler queries the live system, so the
Stampfile itself is the only source of truth: `plan` reports the drift, `apply`
reconciles it, `verify` audits it, and running any of them twice is safe.
There is no state file to lose, no agent to install, and no YAML to wrestle —
just an ordered blueprint and an engine that walks it top to bottom.

**Runtime:** not browser-safe — the engine spawns host tools through
`Bun.spawn` and reads/writes the filesystem (`fs`): handlers shell out to
`brew`, `apt-get`, `zfs`/`zpool`, `incus`, `multipass`, `systemctl`, `ufw`, and
`sshd`. One `.rip` file, plus a `directives/` plugin folder.

## Quick Start

```bash
bun add @rip-lang/stamp
```

```coffee
import { parse } from '@rip-lang/stamp'

{ directives } = parse """
packages curl git jq

container web ubuntu/24.04
  profile trusted
  disk data /tank/web -> /data
  start
"""

directives[0]   # { type: 'packages', name: null, args: ['curl','git','jq'], ... }
directives[1]   # { type: 'container', name: 'web', args: ['ubuntu/24.04'], properties: {...} }
```

Or drive a host straight from the CLI (`stamp.rip` is itself the `rip-stamp`
binary — first line `#!/usr/bin/env rip` — so it works wherever `rip` is
installed; in-repo, `rip stamp.rip ...` is the same thing):

```bash
rip-stamp plan Hostfile       # preview what would change
rip-stamp apply Hostfile      # make it so
rip-stamp verify Hostfile     # audit current state
```

All three commands are read-safe: `plan` and `verify` never modify anything,
and `apply` only changes what does not already match.

## Features

- **No state file** — every handler queries the live system; the Stampfile is
  the source of truth and `apply` is always safe to re-run.
- **Tiny directives** — each handler is a `.rip` file exporting three
  functions (`check`, `apply`, `verify`); no imports, no boilerplate.
- **Injection-safe by default** — commands are built with `$"..."` tagged
  templates, so an interpolated value lands as its own argv element and can
  never become shell code.
- **Pluggable** — drop a `.rip` file in `directives/` and it just works;
  community handlers ship as npm packages or a `use` URL.
- **Cross-platform** — macOS (Homebrew, Multipass) and Linux (apt-get, ZFS,
  Incus, systemd, ufw, sshd).

## Stampfile Syntax

A Stampfile declares the desired state of a system. Each top-level entry names
a resource using a **directive**; indented lines below it describe properties.
The file is read top to bottom — order IS the dependency order.

### Inline — one line, done

```bash
packages curl git jq zfsutils-linux
```

### Block — directive + properties

```bash
container web ubuntu/24.04
  profile trusted
  disk data /tank/web -> /data
  start
```

### Expanded — property with its own sub-block

```bash
container web ubuntu/24.04
  disk data
    source /tank/web
    path /data
    readonly true
```

### Variables

```bash
set POOL   tank
set DEVICE /dev/sdb

pool $POOL $DEVICE
  compression zstd
  atime off
  mountpoint /tank
```

Variables are expanded before parsing. `$NAME` and `${NAME}` both work;
undefined variables expand to the empty string.

### The `->` operator

Source-to-destination mapping for disks, mounts, and similar:

```bash
disk data /tank/web -> /data
disk logs /tank/logs -> /var/log readonly
```

### Grouped directives

Plural forms expand to individual directives before dispatch:

```bash
datasets
  tank/home
  tank/shared
    owner 1001:1001
    mode 2775
```

## Built-in Directives

| Directive   | Purpose                                | Platform |
|-------------|----------------------------------------|----------|
| `brew`      | Homebrew packages                      | macOS    |
| `packages`  | System packages (apt-get)              | Linux    |
| `ensure`    | Guarded imperative commands            | any      |
| `pool`      | ZFS pool creation                      | Linux    |
| `dataset`   | ZFS dataset with ownership/permissions | Linux    |
| `profile`   | Incus profile configuration            | Linux    |
| `container` | Incus container management             | Linux    |
| `incus`     | Incus daemon initialization            | Linux    |
| `multipass` | Multipass virtual machines             | macOS    |
| `user`      | System user management                 | Linux    |
| `group`     | System group management                | Linux    |
| `firewall`  | ufw firewall rules                     | Linux    |
| `ssh`       | SSH daemon configuration               | Linux    |
| `service`   | systemd service management             | Linux    |

## Writing a Directive

A directive is a `.rip` file that exports three functions. No imports needed —
`sh`, `ok`, and `run` are available globally.

```coffee
export name        = "mydirective"
export description = "What it does"

export check = (name, props) ->
  return 'missing' unless ok $"some-check #{name}"
  'ok'

export apply = (name, props) ->
  sh $"some-command #{name}"

export verify = (name, props) ->
  results = []
  if ok $"some-check #{name}"
    results.push { status: 'pass', message: "#{name} is good" }
  else
    results.push { status: 'fail', message: "#{name} is missing" }
  results
```

### Shell helpers

| Helper       | Returns                          | Use case               |
|--------------|----------------------------------|------------------------|
| `sh $"cmd"`  | stdout string, throws on failure | Do the thing           |
| `ok $"cmd"`  | boolean                          | Does this exist?       |
| `run $"cmd"` | `{ ok, stdout, stderr, code }`   | Need the full picture  |
| `sh [array]` | stdout string, throws on failure | Dynamic argument lists |

The `$"..."` syntax prevents shell injection: interpolated values are passed as
separate argv elements, never interpreted by a shell. `sh "string"` (no tag)
still routes through `sh -c` — reserve it for literal commands, never for
values built from Stampfile input.

### Handler contract

- **check** has no side effects. Returns `"ok"`, `"drift"`, or `"missing"`.
- **apply** is idempotent. Only called when check is not `"ok"`; the engine
  runs a post-apply re-check to confirm success.
- **verify** has no side effects. Returns `[{ status, message }]` where status
  is `"pass"`, `"warn"`, or `"fail"`.

### Plugin resolution

Handlers resolve in this order, first match wins:

1. **Built-in** — `directives/` in the stamp package
2. **Local** — `./directives/` beside the Stampfile
3. **Installed** — `~/.stamp/directives/`
4. **npm** — `@stamp/<name>` or `stamp-<name>`
5. **Remote** — fetched via a `use` line in the Stampfile

Drop a file in `./directives/` beside your Stampfile to override any built-in.

## CLI

```bash
rip-stamp apply [file]       Reconcile system to match Stampfile
rip-stamp verify [file]      Check current state, report PASS/WARN/FAIL
rip-stamp plan [file]        Dry-run: show what apply would do
rip-stamp list               Show all available directives
rip-stamp info <directive>   Show a directive's syntax and properties
rip-stamp version            Print version
rip-stamp help               Show help
```

Default file search: `Stampfile`, `Hostfile`, `Containerfile`.

### Exit codes

| Code | Meaning                                                            |
|------|-------------------------------------------------------------------|
| 0    | Success (apply completed, verify had no FAILs, plan found nothing) |
| 1    | Failure (apply error, verify had FAILs, plan found changes)       |
| 2    | Usage error (bad arguments, file not found)                       |

## Test

```bash
bun run test
```

The suite pins the parser end to end (inline, block, expanded, variables, the
`->` operator, plural expansion, quoting, comments, tabs, and a full host
Stampfile), the shell helpers in both string and tagged-template mode, and the
directive plugin contract. The injection-safety cases run every handler through
an injected exec seam and prove a hostile value (`; rm -rf /`) lands as one
argv element and never reaches a shell.
