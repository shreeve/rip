<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip CSV - @rip-lang/csv

> **Fast, flexible CSV parser and writer — indexOf ratchet, auto-detect, zero dependencies.**

The parser is an indexOf ratchet: the JavaScript engine's native
`indexOf` jumps directly to the next delimiter, newline, or quote, so
bulk content is skipped in single native calls — no per-character
scanning and no regex in the hot loop. A probe of the first ~8KB
auto-detects the CSV dialect, so most files parse with zero
configuration.

**Runtime:** not browser-safe — `load`/`save` and the CLI use Bun file
APIs (`read`/`write` are pure string work). One `.rip` file.

## Quick Start

```bash
bun add @rip-lang/csv
```

```coffee
import { CSV } from '@rip-lang/csv'

# Parse a string (delimiter, quoting, line endings auto-detected)
rows = CSV.read "name,age\nAlice,30\nBob,25\n"
# [['name','age'], ['Alice','30'], ['Bob','25']]

# Parse with headers (returns objects)
users = CSV.read "name,age\nAlice,30\nBob,25\n", headers: true
# [{name: 'Alice', age: '30'}, {name: 'Bob', age: '25'}]

# Parse a file
data = CSV.load! 'data.csv', headers: true

# Write CSV
str = CSV.write [['a','b'], ['1','2']]
# "a,b\n1,2\n"

# Write to file
CSV.save! 'out.csv', rows
```

## Features

- indexOf ratchet engine — bulk content skipped in single native calls, no regex in the hot loop
- Auto-detects delimiter, quoting, escaping, BOM, and line endings from an ~8KB probe
- Honors Excel's `sep=` header line; user options always win over probed values
- `headers: true` — first row as keys, rows returned as objects
- `each` callback — row-by-row streaming without building an array; return `false` to halt early
- Excel mode — `="01"` literals preserve leading zeros
- Relax mode — recovers stray/unmatched quotes common in enterprise exports (Labcorp-style files, legacy Excel)
- Comments, whitespace stripping, and blank-line handling
- Writing: compact/full quoting, leading-zero protection (`zeros`), reusable `Writer` instances
- CLI file converter built in (`bun csv.rip in.csv out.csv`)

## How It Works

The parser uses an **indexOf ratchet** — a technique where the JavaScript
engine's native `indexOf` (backed by SIMD instructions in V8 and JSC) does
the heavy lifting. Instead of inspecting every character, the parser calls
`indexOf` to jump directly to the next delimiter, newline, or quote. Each
call can skip hundreds of bytes in a single native operation.

```
Source string:  "Alice,30,New York\nBob,25,Chicago\n..."
                 ↑     ↑  ↑         ↑
                 │     │  │         └── indexOf('\n') jumps here
                 │     │  └── indexOf(',') jumps here
                 │     └── indexOf(',') jumps here
                 └── start

Each indexOf call skips bulk content via SIMD — no per-byte scanning in JS.
```

The parser has two code paths, selected at startup by probing the first ~8KB:

- **Fast path** — no quotes detected: pure indexOf for separators and newlines
- **Full path** — quotes present: indexOf ratchet with quote/escape handling

## Reading

### Basic Parsing

```coffee
# Auto-detects delimiter, quoting, line endings
rows = CSV.read str

# Tab-separated, pipe-separated — auto-detected
rows = CSV.read "a\tb\tc\n1\t2\t3\n"
rows = CSV.read "a|b|c\n1|2|3\n"

# Explicit separator
rows = CSV.read str, sep: ';'
```

### Headers Mode

```coffee
# First row becomes object keys
users = CSV.read str, headers: true
# [{name: 'Alice', age: '30'}, ...]

console.log users[0].name  # "Alice"
```

### Row-by-Row Processing

```coffee
# Process rows one at a time without building an array; returns the row count
count = CSV.read str, each: (row, index) ->
  console.log "Row #{index}: #{row}"

# Early halt by returning false
CSV.read str, each: (row) ->
  if row[0] is 'STOP'
    return false
  process(row)
```

### File I/O

```coffee
# Read a file (async)
rows = CSV.load! 'data.csv'
rows = CSV.load! 'data.csv', headers: true, strip: true

# Row-by-row file processing
CSV.load! 'huge.csv', each: (row) -> db.insert!(row)
```

### Excel Mode

```coffee
# Handles ="01" literals (preserves leading zeros)
rows = CSV.read '="01",hello\n', excel: true
# [['01', 'hello']]
```

### Relax Mode

```coffee
# Recovers from stray/unmatched quotes instead of throwing
rows = CSV.read str, relax: true
```

## Special Cases (Relax + Excel)

When `relax: true` and `excel: true` are both enabled, the parser recovers
from common real-world CSV malformations — stray quotes, unescaped embedded
quotes, and Excel `="..."` literals. These patterns appear frequently in
exports from systems like Labcorp, legacy Excel, and other enterprise tools.
The relax heuristics only fire when a stray quote is actually encountered.

| Input | Fields | Key behavior |
|-------|--------|-------------|
| `"AAA "BBB",CCC,"DDD"` | 3 | Stray quotes recovered (relax) |
| `"CHUI, LOK HANG "BENNY",…,=""` | 5 | Stray quotes + excel empty |
| `"Don",="007",10,"Ed"` | 4 | Excel literal preserves leading zero |
| `Charlie or "Chuck",=B2 + B3,9` | 3 | Unquoted stray quotes + bare formula |
| `A,B,C",D` | 4 | Trailing stray quote preserved |
| `123,"CHO, JOELLE "JOJO"",456` | 3 | Stray quotes (relax) |
| `123,"CHO, JOELLE ""JOJO""",456` | 3 | Properly doubled quotes — same result |
| `=,=x,x=,="x",="","","=",…` | 11 | Full excel + quoting matrix |

```coffee
# Parse messy real-world CSV with both modes enabled
rows = CSV.read str, relax: true, excel: true

# Load a Labcorp file
rows = CSV.load! 'labcorp.csv', relax: true, excel: true, headers: true
```

## Writing

### Basic Writing

```coffee
str = CSV.write [['name','age'], ['Alice','30']]
# "name,age\nAlice,30\n"

# Write to file (async)
CSV.save! 'out.csv', rows
```

### Format a Single Row

```coffee
line = CSV.formatRow ['Alice', 'New York, NY', '30']
# 'Alice,"New York, NY",30'
```

### Reusable Writer

```coffee
w = CSV.writer(sep: '\t', excel: true)

for record in records
  line = w.row(record)
  stream.write "#{line}\n"

# Or format all at once
output = w.rows(records)
```

### Writer Modes

```coffee
# Compact (default): quote only when necessary
CSV.write rows, mode: 'compact'

# Full: quote every field
CSV.write rows, mode: 'full'

# Protect leading zeros for spreadsheets
CSV.write rows, zeros: true    # ="0123",hello

# Drop trailing empty columns
CSV.write rows, drop: true
```

## Options Reference

### Reader Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sep` | string | auto | Field delimiter (`,` `\t` `\|` `;` or any string) |
| `quote` | string | `"` | Quote character |
| `escape` | string | same as `quote` | Escape character (`"` for doubled, `\` for backslash) |
| `headers` | boolean | `false` | First row as keys — return objects |
| `excel` | boolean | `false` | Handle `="01"` literals |
| `relax` | boolean | `false` | Recover from stray quotes |
| `strip` | boolean | `false` | Trim whitespace from fields |
| `comments` | string | `null` | Skip lines starting with this character |
| `skipBlanks` | boolean | `true` | Skip blank lines |
| `row` | string | auto | Line ending override (`\n`, `\r\n`, `\r`) |
| `each` | function | `null` | `(row, index) ->` callback per row |

### Writer Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sep` | string | `','` | Field delimiter |
| `quote` | string | `'"'` | Quote character |
| `escape` | string | same as `quote` | Escape character |
| `mode` | string | `'compact'` | `'compact'` or `'full'` |
| `zeros` | boolean | `false` | Protect leading zeros with `="0123"` |
| `drop` | boolean | `false` | Drop trailing empty columns |
| `rowsep` | string | `'\n'` | Row separator |

> **Note:** The writer defaults to doubled-quote escaping (`""`). Pass
> `escape: '\\'` for backslash style.

## Auto-Detection

When you call `CSV.read(str)` with no options, the probe function scans the
first ~8KB to automatically detect:

- **BOM** — strips UTF-8 BOM if present
- **`sep=` header** — Excel convention for declaring delimiter
- **Delimiter** — tries `,` `\t` `|` `;`, picks the most frequent
- **Quote character** — detects if `"` appears in the sample
- **Escape style** — `\"` (backslash) vs `""` (doubled quote)
- **Line endings** — `\r\n`, `\n`, or `\r`

User options override any probed value.

## API Summary

```coffee
CSV.read(str, opts)            # parse string -> rows or objects
CSV.load!(path, opts)          # parse file (async)
CSV.write(rows, opts)          # format rows -> CSV string
CSV.save!(path, rows, opts)    # write to file (async)
CSV.writer(opts)               # create reusable Writer instance
CSV.formatRow(row, opts)       # format single row -> string
```

## CLI

The library doubles as a command-line tool for converting CSV files:

```bash
# Clean up a malformed Labcorp file
bun csv.rip -r -e input.csv output.csv

# Protect leading zeros for Google Sheets / Excel
bun csv.rip -r -e -z input.csv output.csv

# Pipe to stdout
bun csv.rip -r -e input.csv

# Show version
bun csv.rip -v
```

```
Usage: bun csv.rip [options] <input> [output]

Read options:
  -r, --relax     Recover from stray/malformed quotes
  -e, --excel     Handle Excel ="..." literals on input
  -s, --strip     Strip whitespace from fields

Write options:
  -z, --zeros     Protect leading zeros with ="0123"

General:
  -v, --version   Show version
  -h, --help      Show this help

If output is omitted, writes to stdout.
```

## Performance

```bash
bun run bench                  # workloads + head-to-head, or pass file paths
```

Measured on Apple Silicon under Bun (warm-up pass, best of three):

| Workload | Size | Rows | Time | Throughput |
|----------|------|------|------|-----------|
| Labcorp-style recovery (relax+excel) | 10 MB | 103,820 | 13ms | **797 MB/s** |
| Long fields (300-char cells) | 25 MB | 29,032 | 5ms | **4.6 GB/s** |

The hybrid engine is why the numbers hold across shapes: a JIT'd
`charCodeAt` walk wins on short fields where native-call overhead
dominates, and `indexOf`'s SIMD bulk-skip takes over on long spans —
so wide medical exports and 300-character text cells both stay fast.
The relax+excel heuristics cost nothing until a stray quote actually
appears: recovery mode runs at full speed on clean data.

### Head-to-head

Same strings, same protocol, every parser producing rows of string
arrays. Runs automatically after the workloads above once the
competitor parsers are installed (`bun install` in `bench/`, which
quarantines them away from this package's zero dependencies):

| Parser | Plain | Quoted | Malformation recovery |
|--------|-------|--------|----------------------|
| **Rip CSV** | **578 MB/s** | **814 MB/s** | **~800 MB/s** |
| d3-dsv | 537 MB/s | 362 MB/s | — |
| uDSV | 432 MB/s | 461 MB/s | — |
| PapaParse | 289 MB/s | 206 MB/s | — |
| csv-parse | 57 MB/s | 68 MB/s | — |

On quoted data — the case that actually separates CSV parsers — Rip
CSV is **1.8× uDSV** (the acknowledged fastest JS parser), **2.2×
d3-dsv**, **4× PapaParse**, and **12× csv-parse**. On plain data it
beats d3-dsv in most runs, trading the lead within noise. And it is
the only parser in the field with relax/excel malformation recovery
at all — the others throw or silently mis-parse the enterprise
exports this package was built for.

Numbers are workload- and machine-sensitive — measure on your own data.

## Test

```bash
bun run test
```

The suite pins parsing, writing, Labcorp/excel/relax modes, late-quote
probe behavior, and round-trips.
