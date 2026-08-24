<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Tray

> **One generic macOS host. Many Rip providers. No per-app native binary.**

A tray is an ordinary `.rip` **provider**: it owns title, icon, menu, state, and
callbacks. One reusable SwiftUI **host** (`rip-tray-host`) renders whatever
panel the provider sends and returns clicks. There is no YAML/JSON menu schema
and no Sites-specific code in the host.

**Runtime:** not browser-safe — macOS only; providers use Bun processes and
the host uses SwiftUI/AppKit.

## Mental model

```text
provider.rip          rip-tray-host (ONE program)
├── tray { … }   ──►  ├── MenuBarExtra
├── serve!            ├── renders panel JSON
└── actions/state     └── posts clicks back to Rip
```

Sites is just another provider
([`packages/sites/tray-sites.rip`](../sites/tray-sites.rip)). It is not a second
native app.

## Layout

| Path | Role |
| --- | --- |
| [`tray.rip`](tray.rip) | Toolkit library **and** `rip tray` CLI (discover provider → launch host) |
| [`demo.rip`](demo.rip) | Minimal demo provider — start here |
| [`build.rip`](build.rip) | Optional `rip-tray-build` — Finder `.app` wrapper only |
| [`assets/`](assets/) | Shared Rip SVG artwork |
| [`macos/`](macos/) | Swift: **TrayKit** + **RipTrayHost** (`rip-tray-host`) + **TrayKitCheck** |
| [`test.rip`](test.rip) | Rip suite |
| `macos/.build/` | Compiled host (gitignored) |
| `dist/` | Optional `.app` output (gitignored) |

**Not in this package:** Sites LaunchAgent
([`packages/sites/bin/rip-tray-agent`](../sites/bin/rip-tray-agent)), Sites
provider (`tray-sites.rip`). Repo `bin/` holds only the `rip` compiler CLI.

### Swift pieces

| Target | Product | Why |
| --- | --- | --- |
| `TrayKit` | library | Panel UI + Rip process protocol |
| `RipTrayHost` | `rip-tray-host` | ~20-line `@main` — the **one** runnable host |
| `TrayKitCheck` | `tray-kit-check` | Protocol self-test for CI |

## Quick Start

```bash
cd packages/tray
bun run demo
```

That builds/runs the generic host against [`demo.rip`](demo.rip). Click
**Increment** — Rip state updates and the menu rerenders. Copy `demo.rip` to
start your own provider.

Explicit host launch:

```bash
swift build --package-path macos --product rip-tray-host
RIP_TRAY_RIP=../../bin/rip \
  macos/.build/debug/rip-tray-host "$(pwd)/demo.rip"
```

### `rip tray` — discover + launch the menubar

```bash
rip tray
```

1. Finds a provider in the **current directory**:
   - `tray.rip` (skipped if it is this toolkit file)
   - `tray-<dirname>.rip` — e.g. `packages/sites` → `tray-sites.rip`
2. Launches `rip-tray-host` with that provider (menubar appears).

```bash
cd packages/sites
rip tray              # host + tray-sites.rip
```

From `packages/tray` itself there is no provider file (only the toolkit) —
use `bun run demo` instead. Build the host once if missing:
`swift build -c release --package-path macos --product rip-tray-host`.

## How to run

| Goal | Command |
| --- | --- |
| Demo counter tray | `bun run demo` |
| Menubar for cwd provider | `rip tray` |
| Sites menubar (dev) | `cd packages/sites && rip tray` |
| Sites menubar (launchd) | `packages/sites/bin/rip-tray-agent start\|stop\|status` |
| Any provider path | `rip-tray-host /abs/path/to/provider.rip` |

Bins: `rip-tray` / `rip tray` launches the host; `rip-tray-build` is the optional
`.app` wrapper. After pulling this rename, run `bun run global` once so
`~/.bun/bin/rip-tray` points at the launcher (not the old builder). Restart a
legacy LaunchAgent with `packages/sites/bin/rip-tray-agent start` if you still
have an old `bin/rip-tray` job.

### Environment

| Variable | Meaning |
| --- | --- |
| `RIP_TRAY_RIP` | Path to `rip` (host looks here first; also `~/.bun/rip`, …) |
| `RIP_TRAY_PROVIDER` | Provider path when not passed as the host’s first argument |
| `RIP_TRAY_HOST` | Host binary override (`rip tray` and `rip-tray-agent`) |

## Optional: Finder `.app` (`rip-tray-build`)

Day-to-day use does **not** need a per-app binary. Use `rip-tray-build` only
when you want a double-clickable wrapper that embeds one provider:

```bash
bun run build:demo
# or:
rip-tray-build demo.rip --name Demo --identifier io.example.tray.demo --output dist
open dist/Demo.app
```

Flags: `--name`, `--identifier`, `--output`, `--icon`, `--force`. Prefer inline
SVG in bundled providers — the builder does not chase arbitrary `svgFile` paths.

## Features

- **Pure Rip authoring** — one `.rip` provider is the whole app logic
- **One native host** — SwiftUI `MenuBarExtra` for every provider
- **Apple-style panel** — branded header, status rows, controls, scrollable body
- **Full vocabulary** — labels, separators, actions, toggles, links, submenus, directory pickers, Quit
- **SF Symbols + SVG** — template (menu-bar tint) or full-color logos
- **Adaptive row height** — automatic or per-tray / per-item points
- **Live callbacks** — one persistent Rip process keeps closures and state
- **Loud errors** — bad items, duplicate ids, and host/provider faults stay visible

## How It Works

The provider sends a complete render on start, refresh, and after each action.
Each render replaces the native panel and callback table. Stable action `id`s
preserve identity; duplicates reject before SwiftUI. Stdout is the private
newline-delimited protocol; diagnostics go to stderr.

## Panel Vocabulary

| Constructor | Native result |
| --- | --- |
| `label title, …` | Informational row |
| `separator()` | Divider |
| `action title, id:, run:, …` | Button → Rip closure |
| `toggle title, id:, value:, run:, …` | Check item → Boolean |
| `link title, url, …` | Opens URL |
| `submenu title, items, …` | Nested menu |
| `directory title, id:, run:, …` | Folder picker → path |
| `quit title, …` | Quits the host |
| `svg` / `svgFile` | Icon or `logo:` artwork |
| `tray` / `serve` / `snapshot` | Definition, live loop, test helper |
| `resolveProvider` / `resolveHost` | cwd discovery + host binary for `rip tray` |

Common options: `icon:`, `enabled:`, `rowHeight:`, `subtitle:` (labels),
`prompt:` (directory). Callbacks need a stable `id:` and `run:`.

## Row Height

Default is the ~44pt macOS system rhythm (`rowHeight: 'automatic'` or omit).
Set a positive point minimum on the tray or on one item; values are minima, not
fixed frames.

## Icons

```coffee
icon: 'bolt.horizontal.circle'          # SF Symbol
icon: svg '''<svg …>…</svg>'''          # template-tinted by default
logo: svg COLOR_LOGO, template: false   # full-color panel heading
```

Leading icons share one column when any sibling row has an `icon:`. This package
ships [`rip-color.svg`](assets/rip-color.svg) and
[`rip-template.svg`](assets/rip-template.svg).

## Rip Sites (separate package)

Full instructions:
[packages/sites/README.md — Tray, menubar host](../sites/README.md#tray--menubar-host).

| Piece | Location |
| --- | --- |
| Provider | [`packages/sites/tray-sites.rip`](../sites/tray-sites.rip) |
| LaunchAgent | [`packages/sites/bin/rip-tray-agent`](../sites/bin/rip-tray-agent) |
| CLIs used | `rip sites` only |

```bash
cd packages/sites && rip tray
# or: packages/sites/bin/rip-tray-agent start
```

## Test

```bash
bun run test
bun run test:swift
```

Rip tests cover vocabulary, SVG modes, validation, callbacks, provider
discovery, and compilation of the toolkit plus Sites provider. Swift checks
cover protocol decoding, SVG rendering, and host discovery.
