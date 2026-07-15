# @rip-lang/x12

X12 EDI parser, editor, and query engine. Parse, query, and build X12
transactions (270/271, 835, 837, …) through a path-based addressing
system; field, repetition, component, and segment separators are
auto-detected from the ISA header. Zero dependencies; server-side only
(the module reads files for `X12.load` and the CLI).

## Library

```rip
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

`new X12()` accepts a raw string, another `X12` instance, an array of
`selector, value` pairs, or an object of `selector: value` entries; the
latter three start from the default fixed-width ISA template. `X12.load
path` reads a file. ISA elements are fixed-width: every `set` against
`ISA` pads or truncates the element to its official width.

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
