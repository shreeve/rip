# @rip-lang/csv

Fast, flexible CSV parsing and writing for Rip.

The parser is an indexOf ratchet: the JavaScript engine's native
`indexOf` jumps directly to the next delimiter, newline, or quote, so
bulk content is skipped in single native calls — no per-character
scanning and no regex in the hot loop. A probe of the first ~8KB
auto-detects the delimiter, quoting, escaping, BOM, and line endings.
Reading supports excel mode, relax mode, headers, comments, and
row-callback streaming; writing supports compact/full quoting,
leading-zero protection, and reusable writer instances. One `.rip`
file, zero dependencies. `read`/`write` are pure string work;
`load`/`save` and the CLI use Bun file APIs, so the package does not
claim browser safety.

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

## Reading

```coffee
# Explicit separator (otherwise `,` `\t` `|` `;` are auto-detected)
rows = CSV.read str, sep: ';'

# Row-by-row processing without building an array; returns the row count
count = CSV.read str, each: (row, index) ->
  process(row)

# Early halt by returning false
CSV.read str, each: (row) ->
  return false if row[0] is 'STOP'
  process(row)

# Excel mode: ="01" literals preserve leading zeros
rows = CSV.read '="01",hello\n', excel: true    # [['01', 'hello']]

# Relax mode: recover from stray/unmatched quotes instead of throwing
rows = CSV.read str, relax: true
```

With `relax: true` and `excel: true` together the parser recovers the
malformations common in enterprise exports (Labcorp-style files, legacy
Excel): stray quotes inside quoted fields, unescaped embedded quotes,
doubled quotes at `="..."` boundaries, and bare formulas. The relax
heuristics only fire when a stray quote is actually encountered.

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

The probe also strips a UTF-8 BOM and honors Excel's `sep=` header
line. User options always win over probed values.

## Writing

```coffee
# Compact (default): quote only when necessary
CSV.write rows

# Full: quote every field
CSV.write rows, mode: 'full'

# Protect leading zeros for spreadsheets
CSV.write rows, zeros: true    # ="0123",hello

# Format a single row (no trailing newline)
line = CSV.formatRow ['Alice', 'New York, NY', '30']
# 'Alice,"New York, NY",30'

# Reusable writer
w = CSV.writer(sep: '\t')
line   = w.row(record)      # one line
output = w.rows(records)    # complete string
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sep` | string | `','` | Field delimiter |
| `quote` | string | `'"'` | Quote character |
| `escape` | string | same as `quote` | Escape character |
| `mode` | string | `'compact'` | `'compact'` or `'full'` |
| `zeros` | boolean | `false` | Protect leading zeros with `="0123"` |
| `drop` | boolean | `false` | Drop trailing empty columns |
| `rowsep` | string | `'\n'` | Row separator |

## API

- `CSV.read(str, opts)` — parse a string into row arrays, objects
  (`headers: true`), or a row count (`each` callback).
- `CSV.load!(path, opts)` — read and parse a file (async).
- `CSV.write(rows, opts)` — format row arrays into a CSV string.
- `CSV.save!(path, rows, opts)` — write rows to a file (async).
- `CSV.writer(opts)` — a reusable `Writer` with `row(data)` and
  `rows(data)`.
- `CSV.formatRow(row, opts)` — format a single row.

## CLI

The module doubles as a file converter when run directly:

```sh
bun csv.rip [options] <input> [output]

#  -r, --relax     Recover from stray/malformed quotes
#  -e, --excel     Handle Excel ="..." literals on input
#  -s, --strip     Strip whitespace from fields
#  -z, --zeros     Protect leading zeros with ="0123"
#  -v, --version   Show version
#  -h, --help      Show this help
```

If output is omitted, the converted CSV is written to stdout.

## Test

```sh
bun run test
```
