<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Utils - @rip-lang/utils

> **Small single-script CLI utilities for common tasks — zero dependencies.**

A collection of standalone scripts, each solving one problem cleanly.
Every utility is a single `.rip` file with no dependencies beyond Rip
itself — the file is the binary (`#!/usr/bin/env rip`). Run them via
their `rip-<name>` command, as `rip <name>.rip`, or copy them into a
project as examples of practical Rip.

**Runtime:** not browser-safe — utilities read the filesystem, the
process environment, and (for `rip-curl`) the network. One `.rip` file
per utility; each is itself a binary.

## Quick Start

```bash
bun add @rip-lang/utils
```

```bash
rip-curl 'https://api.example.com/users'
```

## Utilities

### rip-curl — HTTP client with variable interpolation

A command-line HTTP client that parses a compact request format with
variable interpolation. Variables resolve from four sources in priority
order: CLI arguments, a local `.auth` file, a local `.env` file, and
the process environment.

```bash
# Simple GET
rip-curl 'https://api.example.com/users'

# POST with headers and JSON body
rip-curl token=abc123 '
POST https://api.example.com/users
Authorization: Bearer ${token}
Content-Type: application/json
{ "name": "Alice", "role": "admin" }
'

# Variables from .auth (key=value, one per line)
echo 'token=secret123' > .auth
rip-curl '
GET https://api.example.com/me
Authorization: Bearer ${token}
'
```

**Request format:**

```
[METHOD] URL              ← first line (METHOD optional, defaults to GET or POST)
Header-Name: value        ← headers (until blank line or body start)
                          ← optional blank line
{ "json": "body" }        ← body (auto-sets method to POST if present)
```

**Variable resolution:** `${name}` and `#{name}` are replaced from:

1. CLI arguments (`key=val` pairs before the request)
2. `.auth` file (key=value, one per line, `#` comments)
3. `.env` file (same format)
4. Process environment

If a variable is undefined in all four sources, the script exits with
an error. JSON responses are automatically pretty-printed.

## Features

- Auto-detects HTTP method (POST if body present, GET otherwise)
- Parses headers from colon-separated lines
- Pretty-prints JSON responses, passes through plain text
- Loads credentials from `.auth` / `.env` (gitignore-friendly)
- Supports GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS

## Adding a Utility

Drop a `.rip` file into this directory. Each utility should:

- Be a single self-contained script (`#!/usr/bin/env rip`, executable)
- Reject loudly when imported (`import.meta.main` guard)
- Read its version from this package's `package.json`
- Have zero external dependencies
- Solve one problem well

Then add a `"bin"` entry (`"rip-<name>": "./<name>.rip"`), list the
file under `"files"`, document it above, and extend `test.rip`.

## Test

```bash
bun run test
```

Covers the package surface and every `rip-curl` path that matters:
flags, usage errors, variable priority, request parsing, and live HTTP
against a local server.
