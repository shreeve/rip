# @rip-lang/validate

The validation and normalization vocabulary for Rip.

One registry of pure, synchronous normalizers. Every validator takes a
value and returns its normalized form, or `null` on miss. The functions
are plain string/regex/arithmetic — no host APIs — so the same
vocabulary runs in the browser and on the server. The vocabulary is
US-English: phones are NANP, `zip`/`state` are US-shaped, and
name/address casing follows US conventions.

```coffee
import { check, registerValidator } from '@rip-lang/validate'

check '2024-02-29', 'date'      # '2024-02-29' — calendar-true, leap years included
check '$1,292.22', 'money'      # 129222 — dollars in, integer cents out
check 'FOO@Example.COM', 'email' # 'foo@example.com'

registerValidator 'even', (v) ->
  n = parseInt(v, 10)
  if Number.isInteger(n) and n % 2 is 0 then n else null
```

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

- `money`/`money_even` take **dollars** and return **integer cents**
  (half-up / half-to-even, computed on the magnitude, so ties round
  away from zero); commas must group thousands (`1,00` misses);
  `cents` takes a value already in cents; `decimal` is a lossless
  arbitrary-scale string.
- Blank input is not a miss for the string family: `string`, `text`,
  `name`, `address`, and `phone` normalize `''` to `''`.
- `date` validity comes from the written components — pure calendar
  math, leap years included, no `Date` construction — and normalizes to
  `YYYY-MM-DD`.
- `array`, `hash`, and `json` are the raw set: they receive the value
  untouched. Every other validator receives its string form.
- Identical inputs validate identically, always — validators hold no
  state.

## Schema coercion

Importing the bridge registers the whole vocabulary as `~:name` schema
coercers — one vocabulary serving both call sites — and keeps later
`registerValidator` additions registered as they arrive:

```coffee
import '@rip-lang/validate/coercers'

Order = schema
  total! ~:money
  placed! ~:date
```

Raw validators register raw, so their coercers receive values
untouched. Registering a coercer name twice, or registering an async or
generator function, rejects loudly — including at the bridge import
itself when a name is already claimed. The bridge resolves the schema
runtime inside this repository; the package is private and ships with
the compiler. The two call sites prepare input
differently: schema coercion trims non-raw wire input before the
validator runs; `check()` passes the string form untouched. A coerced
`false` is a value (`~:bool` accepts falsy tokens), never a miss.

## API

- `check(value, type)` — apply a validator to a value in hand; an
  unknown type name rejects loudly.
- `getValidator(name)` — the validator function, or `undefined`.
- `registerValidator(name, fn, { raw? })` — add to the vocabulary.
  Registering an existing name, a non-function, or an async function
  rejects loudly.
- `validatorNames()` — the sorted vocabulary.
- `isBlank(obj)` — nullish, `false`, whitespace-only string, empty
  array, or empty object.
- `toName(str, ...packs)` — US-English title casing; packs `'name'` and
  `'address'` enable their rule sets.
- `toPhone(str)` — NANP normalization with extension parsing; `""` for
  blank input, `null` on miss.
- `formatMoney(cents, { symbol?, commas? })` — display formatting for
  integer cents.

## Test

```sh
bun run test
```
