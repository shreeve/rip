<img src="https://raw.githubusercontent.com/shreeve/rip-lang/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Tray - @rip-lang/tray

> **Pure-Rip macOS menu-bar apps rendered by one small reusable SwiftUI host**

A tray app is an ordinary `.rip` program. It computes its own title, SF
Symbol, menu tree, state, and callbacks with the full Rip language — functions,
loops, conditions, imports, processes, and reactive data included. There is no
manifest format, YAML schema, JSON configuration, or second template language.
The native host knows only how to render menu items and return user actions.

**Runtime:** not browser-safe — providers use Bun processes and the native host
uses SwiftUI/AppKit. One `.rip` library plus one reusable Swift host.

## Quick Start

```bash
bun add @rip-lang/tray
```

Create `example.rip`:

```coffee
#!/usr/bin/env rip

import { action, label, quit, separator, serve, tray } from '@rip-lang/tray'

count = 0

app = tray
  title: 'Example'
  icon: 'star.circle'
  refresh: 0
  menu: -> [
    label "Count: #{count}", icon: 'number.circle'
    separator()
    action 'Increment', id: 'increment', icon: 'plus', run: -> count++
    quit()
  ]

serve! app if import.meta.main
```

Run it through the generic native host:

```bash
cd packages/tray
RIP_TRAY_RIP=../../bin/rip swift run --package-path macos rip-tray-host /absolute/path/to/example.rip
```

Clicking **Increment** calls the Rip closure, changes ordinary Rip state, and
rerenders the native menu. The Swift application contains no app-specific menu
or command logic.

Build it as a Finder-launchable application:

```bash
rip-tray example.rip \
  --name Example \
  --identifier io.example.tray.example \
  --output dist
open dist/Example.app
```

`rip-tray` compiles the shared host, embeds the selected provider and tray
runtime, writes an `LSUIElement` application bundle, and applies an ad-hoc
signature. Use the same command with another provider, name, and identifier to
build another independent tray app. Pass `--icon AppIcon.icns` for a bundle
icon and `--force` when intentionally replacing that exact destination.

## Features

- **Pure Rip authoring** — the complete application is one `.rip` program
- **One native host** — SwiftUI's `MenuBarExtra` renders any tray provider
- **Full menu vocabulary** — labels, separators, actions, toggles, links,
  submenus, directory pickers, and Quit
- **Native icons** — the tray and every item may name an SF Symbol
- **Live callbacks** — one persistent Rip process retains closures and state
- **Computed menus** — ordinary Rip loops and conditions build each render
- **Automatic refresh** — a provider chooses its own interval or disables it
- **Loud boundaries** — malformed items, duplicate action IDs, provider errors,
  and invalid host messages remain visible instead of producing an empty menu

## How It Works

```text
your tray.rip
├── owns state, data, commands, and callbacks
├── computes a complete menu tree
└── serves the tree through @rip-lang/tray
                │
                │ private render/action protocol
                ▼
generic SwiftUI host
├── MenuBarExtra status item
├── native labels, icons, menus, and pickers
└── sends each click back to its Rip callback
```

The provider sends a complete render whenever it starts, refreshes, or handles
an action. Each render atomically replaces the native menu and callback table.
Stable action IDs preserve identity; duplicates reject before the menu reaches
SwiftUI. Standard output is reserved for the private newline-delimited
transport, while provider diagnostics use standard error.

## Menu Vocabulary

Every constructor returns an ordinary Rip object, so items compose naturally
in arrays, comprehensions, and helper functions.

| Constructor | Native result |
| --- | --- |
| `label title, ...` | Informational, disabled menu row |
| `separator()` | Native divider |
| `action title, id:, run:, ...` | Button calling a Rip closure |
| `toggle title, id:, value:, run:, ...` | Checked item passing its new Boolean |
| `link title, url, ...` | URL opened through macOS |
| `submenu title, items, ...` | Nested native menu |
| `directory title, id:, run:, ...` | Directory picker passing the selected path |
| `quit title, ...` | Terminates the native host |

Common options are `icon:` (an SF Symbol name) and `enabled:`. Callback items
require a stable `id:` and `run:` function. A directory callback receives the
selected path; a toggle callback receives the requested Boolean value.

## Rip Apps Tray

The package's executable [`tray.rip`](tray.rip) mode is the first complete tray
app. It uses only the public `rip edge` and `rip app` commands to:

- show whether the shared Caddy/Janus edge is stopped, external, or Rip-owned
- start, stop, or reload the edge when Rip owns it
- list every remembered Rip application and its live state
- start, stop, restart, and open applications
- open an application's manager log
- add a project with the native macOS directory picker

Run it from this package:

```bash
bun run demo
```

`RIP_TRAY_RIP` selects the Rip executable. `RIP_TRAY_PROVIDER` selects a
provider when it is not passed as the host's first argument.

## Native Host

`TrayKit` is the reusable Swift package. `rip-tray-host` is its minimal
executable: an accessory application with no Dock icon and one SwiftUI
`MenuBarExtra`. The host resolves and launches `rip`, decodes the provider's
menu, renders it, presents native directory panels and URLs, and returns action
messages. It contains no knowledge of Rip Server or the included provider.

The built application still locates the machine's `rip` executable at runtime;
`~/.bun/rip` and `~/.bun/bin/rip` are checked automatically. Run
`bun run link-global` once on a development machine or set `RIP_TRAY_RIP` when
launching the host directly. A portable bundle embeds one provider file and
the tray runtime; keep that provider self-contained apart from
`@rip-lang/tray`, Node/Bun built-ins, and commands available on the machine.

## Test

```bash
bun run test
bun run test:swift
```

The Rip suite pins the public vocabulary, normalization, strict validation,
callback dispatch, stateful rerendering, and compilation of the included app.
The Swift check pins protocol decoding and executable/provider discovery; a
normal Swift build compiles both the reusable library and menu-bar host.
