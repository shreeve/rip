<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Google Sheets - @rip-lang/googlesheets

> **Google Sheets for Rip — silent OAuth refresh, A1 helpers, and the fluid sheet ops from the old Ruby gem.**

Drop-in replacement for the personal Ruby `googlesheets` gem and the
invoices `lib/sheets.rip` helper. Credentials stay at
`~/.google/credentials.json` + `token.yaml` (googleauth shape). Access
tokens refresh quietly; first run opens a loopback browser login (no
OOB copy-paste).

Import as `rip/googlesheets` when Rip is on the machine (stdlib
namespace), or `@rip-lang/googlesheets` from a workspace install.

**Runtime:** server-side (Bun / Node file + `fetch`). Not browser-safe.

## Quick Start

```coffee
import { authorize, open, parseSheet } from 'rip/googlesheets'

authorize!

sheet = open! 'https://docs.google.com/spreadsheets/d/<id>/edit#gid=0'
rows  = sheet.read!          # default tab + A:ZZ
sheet.write! 'Clinics!A1', [['Name', 'City'], ['Ada', 'SF']]
sheet.format! 'B:B', '#,##0.00'
sheet.color! 'Clinics', '#4a86e8'
sheet.rename! 'Sheet1', 'Clinics'

{ val, rows: people } = parseSheet sheet.read!('People!A:Z')
console.log val(people[0], 'Name')
```

ssid-first helpers (same names as the invoices scripts):

```coffee
import { authorize, sheetRead, sheetWrite, sheetClear, sheetNames } from 'rip/googlesheets'

authorize!
names = sheetNames! ssid
grid  = sheetRead! ssid, "#{names[0]}!A:AZ"
sheetClear! ssid, 'Clinics'
sheetWrite! ssid, 'Clinics!A1', rows
```

## Auth

| File | Role |
|------|------|
| `~/.google/credentials.json` | Desktop OAuth client (`installed.client_id` / `client_secret`) |
| `~/.google/token.yaml` | googleauth `FileTokenStore` (`default: '<json>'`) |

- `authorize!` — reuse a fresh access token, else refresh, else `login!`
- `login!` — localhost loopback consent (writes `token.yaml` with a refresh token)
- Never deletes the refresh token on access-token expiry (that was the Ruby gem footgun)

Google Cloud: create an **Desktop** OAuth client, add
`http://127.0.0.1` (and/or `http://localhost`) under redirect URIs, download
JSON to `~/.google/credentials.json`.

## Sheet API

`open!(urlOrId)` → `Sheet` (parses `/d/<id>/` and optional `#gid=` / `!range`).

| Method | Role |
|--------|------|
| `read(area?)` | Values get (`USER_ENTERED` grid) |
| `write(area, rows)` / `save(area, rows)` | Values update; `save` returns `updatedCells` |
| `clear(area?)` | Clear values |
| `names()` / `list()` | Tab titles / `{ id, name, color? }` |
| `rename(tab, title)` | Rename tab |
| `color(tab, '#rrggbb')` | Tab color |
| `filter(area, { A: 'x', B: ['y'] })` | Basic filter (`TEXT_EQ`) |
| `format(area, pattern)` | Number format pattern |
| `resolveArea` / `sheetName` / `sheetId` / `range` | A1 + GridRange |
| `refresh()` | Bust cached sheet properties |

## Helpers

| Export | Role |
|--------|------|
| `biject` | `A` ↔ `1`, `AA` ↔ `27`, … |
| `hex2rgb` / `rgb2hex` | Tab / theme colors |
| `extractSsid` | Id from a Docs URL |
| `parseSheet` | Header row → `{ hdrs, rows, val }` |
| `filterCriteria` | Letter map → Sheets filter JSON |

## CLI

```bash
rip-shat -fs 'https://docs.google.com/spreadsheets/d/<id>/edit#gid=0'
# options: -f/--fill  -s|-t/--strip  --csv|--psv|--tsv
# clusters work: -fs / -ft (same as old Ruby shat)
```

## From the Ruby gem

| Ruby | Rip |
|------|-----|
| `GoogleSheets.new(url)` | `open!(url)` |
| `sheet_read` / `sheet_save` | `sheet.read!` / `sheet.write!` (or `save!`) |
| `sheet_clear` / `sheet_rename` / `sheet_color` | `clear!` / `rename!` / `color!` |
| `sheet_filter` / `sheet_format` | `filter!` / `format!` |
| `biject` / `hex2rgb` | same names |
| OOB paste every expiry | silent refresh; loopback once |

## License

Part of the Rip repository.
