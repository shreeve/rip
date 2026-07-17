<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Validate - @rip-lang/validate

> **The validation and normalization vocabulary — 37 pure US-English normalizers, one registry, doubling as ~:name schema coercers.**

One registry of pure, synchronous normalizers: every validator takes a
value and returns its normalized form, or `null` on miss. The functions
are plain string/regex/arithmetic — no host APIs — so the same
vocabulary runs in the browser and on the server. Importing the package
also registers every validator as a `~:name` schema coercer, so
`amount! ~:money` works with no further setup, and `registerValidator`
extends both vocabularies at once. US-English throughout: phones are
NANP, `zip`/`state` are US-shaped, name/address casing follows US
conventions.

**Runtime:** browser-safe (`rip.browser: true`). One `.rip` file; its
only import is the schema runtime, which the browser bundler bridges to
the page's single copy.

## Quick Start

```bash
bun add @rip-lang/validate
```

```coffee
import { check, registerValidator } from '@rip-lang/validate'

check '2024-02-29', 'date'       # '2024-02-29' — calendar-true, leap years included
check '$1,292.22', 'money'       # 129222 — dollars in, integer cents out
check 'FOO@Example.COM', 'email' # 'foo@example.com'

# The same names work as schema coercers, no bridge import:
Order = schema
  total! ~:money
  placed! ~:date

# One registration extends both vocabularies
registerValidator 'even', (v) ->
  n = parseInt(v, 10)
  if Number.isInteger(n) and n % 2 is 0 then n else null
```

## Features

- **37 built-in normalizers** across numbers, money, strings,
  names/addresses, dates, booleans, identity, network, and structured
  data
- **Calendar-true dates** — pure calendar math with leap years; an
  impossible date can never normalize into a neighboring real one
- **Money as integer cents** — dollars in, cents out, half-up
  (`money`) or half-to-even (`money_even`) at the third fractional
  digit
- **One import, both vocabularies** — the same table powers `check()`
  and `~:name` schema coercion; collisions reject loudly at the site
- **Loud registry** — duplicate names, non-functions, and async
  functions reject; `check` on an unknown type throws
- **Raw set** — `array` / `hash` / `json` receive values untouched;
  everything else gets the string form

## The vocabulary (37 names)

| Family | Names |
|---|---|
| numbers | `id` `int` `whole` `float` |
| money | `money` `money_even` `cents` `decimal` |
| strings | `string` `text` `name` `address` `slug` |
| date/time | `date` `time` `time12` |
| booleans | `truthy` `falsy` `bool` |
| identity | `email` `state` `zip` `zipplus4` `ssn` `sex` `phone` `username` |
| technical | `ip` `mac` `url` `color` `uuid` `semver` |
| structured | `array` `hash` `json` `ids` |

Contracts worth knowing:

- `money`/`money_even` take **dollars** and return **integer cents**;
  `cents` takes a value already in cents; `decimal` is a lossless
  arbitrary-scale **string**
- `date` requires a real calendar date and always answers the
  canonical `YYYY-MM-DD` spelling
- `id` is a positive integer with no leading zero, at most 15 digits
  (safe-integer territory); `ids` parses, dedupes, and sorts a list of
  them
- `phone` normalizes NANP numbers to `(nnn) nnn-nnnn` with extension
  parsing; `+`-international passes through digits-only
- The two call sites prepare input differently by design: schema
  coercion trims non-raw wire input before the validator runs, while
  `check()` passes the string form untouched

## The registry

```coffee
registerValidator name, fn            # string in, normalized-or-null out
registerValidator name, fn, raw: true # receives values untouched
getValidator name                     # the function, or undefined
isRawType name                        # raw flag; unknown names answer false
validatorNames()                      # sorted list
check value, type                     # apply by name; unknown type throws
```

Registration is atomic across both vocabularies: the `~:name` coercer
registers first, so a coercer-name collision rejects loudly and leaves
the validator registry unchanged — the two tables never disagree about
a name.

## Test

```bash
bun run test
```

The suite pins all 37 validators row by row (152 contracts), the
registry's rejection paths, the utility functions, and the schema
bridge — including fresh-process registration and collision loudness as
real subprocesses.
