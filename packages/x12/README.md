<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip X12 - @rip-lang/x12

> **X12 EDI parser, editor, and query engine — path-based addressing over auto-detected separators, zero dependencies.**

Parse, query, edit, and build X12 transactions (270/271, 835, 837, …)
through one selector grammar: `seg(num)-fld(rep).com` addresses any
value in a message, for both reads and writes. The four delimiter
levels are auto-detected from the ISA header, ISA elements are held to
their official fixed widths on every write, and a message round-trips
byte-for-byte between its string and segment-array forms.

**Runtime:** not browser-safe — `X12.load` and the CLI read the
filesystem (`fs`). One `.rip` file.

## Quick Start

```bash
bun add @rip-lang/x12
```

```coffee
import { X12 } from '@rip-lang/x12'

# Parse an X12 message
x12 = new X12 rawString

# Get values using path addressing
sender   = x12.get "ISA-6"        # ISA segment, field 6
receiver = x12.get "ISA-8"        # ISA segment, field 8
code     = x12.get "EB-1"         # First EB segment, field 1
third    = x12.get "EB(3)-4"      # 3rd EB segment, field 4
comp     = x12.get "EB(3)-4(2).1" # 3rd EB, field 4, repeat 2, component 1
count    = x12.get "EB(?)"        # Count of EB segments

# Set values (a fresh `new X12()` seeds a valid fixed-width ISA envelope)
x12.set "ISA-6", "NEWSENDER"
x12.set "GS-2", "NEWID"
x12.set "REF(+)-1", ["EI", "123456789"]   # append a new REF segment

# Query multiple values at once
[sender, receiver] = x12.find "ISA-6", "ISA-8"

# Display formatted output
x12.show 'down', 'full'   # lowercase segments, show body

# Iterate segments
x12.each (row) -> console.log row[0]
x12.each 'EB', (row) -> console.log row

# Get the raw single-line X12 string
output = x12.raw()
```

`new X12()` accepts a raw string, another `X12` instance (an exact
clone), an array of `selector, value` pairs, or an object of
`selector: value` entries; the latter two start from the default
fixed-width ISA template. `X12.load path` reads a file.

## Features

- **One selector grammar** — the same `seg(num)-fld(rep).com` path
  reads and writes fields, repetitions, and components
- **Separator auto-detection** — field, repetition, component, and
  segment delimiters come from the ISA header, never configuration
- **ISA fixed widths** — every write against `ISA` pads or truncates
  the element to its official width
- **Occurrence operators** — `(n)` nth, `(?)` count, `(*)` all,
  `(+)` append
- **Editor semantics** — writes splice in place, pad skipped
  positions, and invalidate the cached string form
- **Multi-query `find`** — several selectors in one call, answers in
  order
- **CLI** — query, list, and filter `.x12` files and directories

## Path addressing

```
seg(num)-fld(rep).com

seg      — Segment name (2-3 chars): ISA, GS, EB, CLP, …
(num)    — Segment occurrence: (1)=first, (?)=count, (*)=all, (+)=new
-fld     — Field number (1-based)
(rep)    — Repetition within field: (1)=first, (?)=count, (+)=new
.com     — Component within repeat (1-based)
```

| Path           | Meaning                             |
|----------------|-------------------------------------|
| `ISA-6`        | ISA segment, field 6                |
| `EB(3)-4`      | 3rd EB segment, field 4             |
| `EB(*)-4`      | Field 4 from ALL EB segments        |
| `EB(?)`        | COUNT of EB segments                |
| `EB-4(?)`      | COUNT of repetitions in field 4     |
| `EB(3)-4(2)`   | 3rd EB, field 4, 2nd repetition     |
| `EB(3)-4(2).1` | 3rd EB, field 4, 2nd rep, component |

Dot and dash are interchangeable position separators: `NM1.3` and
`NM1-3` address the same value. A component write with no explicit
repetition goes through repetition 1, exactly like the matching read.

## Separators

X12 uses four delimiter levels, auto-detected from the ISA header and
exposed as `fld`, `rep`, `com`, and `seg` on every instance:

| Separator  | ISA position | Default | Purpose                          |
|------------|--------------|---------|----------------------------------|
| Field      | 4            | `*`     | Separates fields within a segment|
| Repetition | 83           | `^`     | Separates repeats within a field |
| Component  | 105          | `:`     | Separates sub-components         |
| Segment    | 106          | `~`     | Ends a segment                   |

An ISA-11 of `U` (the pre-5010 "U.S. EDI community" marker) falls back
to `^` as the repetition separator.

## CLI

There is no wrapper script: `x12.rip` is itself the `rip-x12` binary
(first line `#!/usr/bin/env rip`), so the command works wherever `rip`
is installed. In-repo, `rip x12.rip ...` is the same thing.

```bash
rip-x12 -f message.x12              # show fields
rip-x12 -q "ISA-6,GS-2" message.x12 # query specific values
rip-x12 -m message.x12              # show message body
rip-x12 -d -f /path/to/edi/         # recursive directory scan
```

| Flag                 | Description                              |
|----------------------|------------------------------------------|
| `-a, --after <date>` | Filter files modified after date (YYYYMMDD) |
| `--ansi`             | ANSI color output                        |
| `-c, --count`        | Count messages                           |
| `-d, --dive`         | Recursive directory scan                 |
| `-f, --fields`       | Show fields                              |
| `-F, --fields-only`  | Fields only, no occurrence indicators    |
| `-h, --help`         | Help                                     |
| `-i, --ignore`       | Skip malformed files                     |
| `-l, --lower`        | Lowercase segment names                  |
| `-m, --message`      | Show message body                        |
| `-p, --path`         | Show file path                           |
| `-q, --query <val>`  | Query specific values (comma-separated)  |
| `-s, --spacer`       | Blank line between messages              |
| `-t, --tsv`          | Tab-delimited query output               |
| `-v, --version`      | Show version                             |

## Test

```bash
bun run test
```

The suite pins the selector grammar, construction forms, get/set
through fields, repetitions, and components, ISA width enforcement,
iteration, multi-query `find`, `show` formatting, the CLI as a real
subprocess, and the 270/271 and 835/837 consumer patterns.
