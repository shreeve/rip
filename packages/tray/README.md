<img src="assets/rip-color.svg" alt="Rip" width="50" />

# Rip Tray - @rip-lang/tray

> **Pure-Rip macOS menu-bar apps rendered by one small reusable SwiftUI host**

A tray app is an ordinary `.rip` program. It computes its own title, icon,
panel, state, and callbacks with the full Rip language — functions, loops,
conditions, imports, processes, and reactive data included. There is no
manifest format, YAML schema, JSON configuration, or second template language.
The native host knows only how to render the panel and return user actions.

**Runtime:** not browser-safe — providers use Bun processes and the native host
uses SwiftUI/AppKit. One `.rip` library plus one reusable Swift host.

## Quick Start

```bash
bun add @rip-lang/tray
```

Create `example.rip`:

```coffee
#!/usr/bin/env rip

import { action, label, quit, separator, serve, svg, tray } from '@rip-lang/tray'

count = 0

app = tray
  title: 'Example'
  icon: svg '''
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M12 2 15 9l7 .6-5.3 4.7 1.6 7.2L12 17.8l-6.3 3.7 1.6-7.2L2 9.6 9 9z"/>
    </svg>
    '''
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
- **Apple-style panel** — a rounded native popover with a branded header,
  flat status rows, contextual controls, and a scrollable body
- **Full panel vocabulary** — labels, separators, actions, toggles, links,
  submenus, directory pickers, and Quit
- **Native and custom icons** — SF Symbols plus inline or file-backed SVGs
- **Live callbacks** — one persistent Rip process retains closures and state
- **Computed menus** — ordinary Rip loops and conditions build each render
- **Automatic refresh** — a provider chooses its own interval or disables it
- **Loud boundaries** — malformed items, duplicate action IDs, provider errors,
  and invalid host messages remain visible instead of producing an empty menu

## How It Works

```text
your tray.rip
├── owns state, data, commands, and callbacks
├── computes a complete panel tree
└── serves the tree through @rip-lang/tray
                │
                │ private render/action protocol
                ▼
generic SwiftUI host
├── MenuBarExtra status item
├── native popover, labels, icons, controls, and pickers
└── sends each click back to its Rip callback
```

The provider sends a complete render whenever it starts, refreshes, or handles
an action. Each render atomically replaces the native panel and callback table.
Stable action IDs preserve identity; duplicates reject before the menu reaches
SwiftUI. Standard output is reserved for the private newline-delimited
transport, while provider diagnostics use standard error.

## Panel Vocabulary

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

Common options are `icon:` and `enabled:`. Callback items require a stable
`id:` and `run:` function. A directory callback receives the selected path; a
toggle callback receives the requested Boolean value.

## Icons

A string remains the compact spelling for an SF Symbol:

```coffee
icon: 'bolt.horizontal.circle'
```

Leading icons align as one sibling-group column. If any row in a group supplies
`icon:`, every row reserves that column; when no row supplies one, the column
disappears completely.

Inline SVG keeps a complete tray app in one `.rip` file. SVGs use macOS
template rendering by default: their color is replaced by the system's current
menu-bar foreground, so they follow light mode, dark mode, selection, and
accessibility contrast automatically.

```coffee
icon: svg '''
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...</svg>
  '''
```

Preserve authored colors explicitly when an image belongs inside the panel:

```coffee
logo: svg COLOR_LOGO, template: false
```

`logo:` replaces the panel's text heading with a branded image at the upper
left; omitting it keeps the heading typographic. `svgFile './logo.svg'` reads a
file relative to the provider's working directory. Prefer inline SVG when
building a self-contained `.app`, since the builder cannot infer arbitrary
files read by provider code. This package ships
[`rip-color.svg`](assets/rip-color.svg) and
[`rip-template.svg`](assets/rip-template.svg) as ready-to-use Rip artwork.

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
`MenuBarExtra` using the native window presentation. The host resolves and
launches `rip`, decodes the provider's panel, renders it, presents native
directory pickers and URLs, and returns action messages. It contains no
knowledge of Rip Server or the included provider.

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

The Rip suite pins the public vocabulary, SVG modes, normalization, strict
validation, callback dispatch, stateful rerendering, and compilation of the
included app. The Swift check pins protocol decoding, native SVG rendering,
and executable/provider discovery; a normal Swift build compiles both the
reusable library and menu-bar host.
