<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Print

> **Syntax-highlighted source code printer — highlight.js under the hood, 40+ file extensions routed to their grammars, served once to your browser, print-ready.**

`rip-print` highlights the files you point it at, serves the result
once on `http://localhost:9111/` (or a free port when 9111 is taken —
the URL is printed), opens your browser, and exits — no output files,
no cleanup, nothing left running. Rip sources highlight
through the repository's shared grammar (`rip/highlight`), so
Rip Print and the editor surfaces stay in lockstep. This is a pure
CLI: `print.rip` is the whole program and there is no library export
surface — importing it throws.

**Runtime:** not browser-safe — it reads the filesystem, serves with
`Bun.serve`, and shells out to open a browser. One `.rip` file, which
is itself the `rip-print` binary (first line `#!/usr/bin/env rip`).

## Quick Start

```bash
rip-print src/                # Print all source files in src/
rip-print a.rip b.js          # Print specific files
rip-print -d src/             # Dark theme (default: light)
rip-print -b src/             # Strip leading comment blocks
rip-print -x lock,map src/    # Exclude extensions
rip-print notes.md            # A single .md renders as a document
```

## Features

- **Per-file sections** with line numbers, language tags, and mtime
  stamps
- **Two-column table of contents** when printing more than one file,
  with prev / next / top navigation between files
- **14-theme switcher** (7 light, 7 dark) and S/M/L font sizing, both
  remembered in `localStorage`
- **Print-ready CSS** — `@media print` styling with exact color
  adjustment
- **Rip-aware HTML** — `<script type="text/rip">` blocks inside HTML
  files re-highlight as Rip
- **Your own languages** — drop a highlight.js language file in a
  folder and its extensions print highlighted ([below](#adding-a-language))
- **Markdown mode** — a single `.md` argument renders the document
  instead of showing its source (`-d` force-darkens it)
- **Serve-once lifecycle** — first request wins, then the server stops
  and the process exits

## Options

| Flag | Effect |
| --- | --- |
| `-b, --bypass` | Strip leading comment blocks from files |
| `-d, --dark` | Dark theme (default: light) |
| `-h, --help` | Usage |
| `-v, --version` | Version (read from package.json) |
| `-x <exts>` | Comma list of extensions to exclude |

## File discovery

Directory arguments walk recursively with a sorted result. Dotfiles,
`.git`, `node_modules`, `dist`, and other generated trees are skipped,
as are binary and lock extensions (images, fonts, archives, maps,
databases, …); `-x` extends the exclusion list. `Makefile`,
`Dockerfile`, and rc-file names detect their language by filename;
unknown extensions fall back to plaintext unless a language you added
claims them.

## Adding a language

Rip Print highlights any language highlight.js can, including ones it
has never heard of: put the language's highlight.js module in

```
~/.config/rip/print/languages/
```

(`$XDG_CONFIG_HOME/rip/print/languages/` when `XDG_CONFIG_HOME` is
set), and files with its extensions print highlighted. Nothing in Rip
Print changes.

The module is an ES module whose default export is the highlight.js
language function, plus an optional list of the file extensions it
prints:

```js
export const extensions = ['rig'];

export default function (hljs) {
  return {
    name: 'Rig',
    keywords: { keyword: 'fun let if else while return' },
    contains: [hljs.QUOTE_STRING_MODE, hljs.C_LINE_COMMENT_MODE, hljs.NUMBER_MODE],
  };
}
```

- **The name** is the file's name: `rig.js` registers the language
  `rig`, which the console report shows as `[rig]`.
- **The extensions** are the `extensions` export. Without one, the
  language claims its own name and its `aliases`.
- **A language here wins** over a built-in of the same name or
  extension, so a folder file can also replace one Rip Print ships.

A module that fails to load, has no default function, or claims an
extension another file in the folder claims stops `rip-print` with an
error naming the file. Printing on without it would leave those files
plain with nothing said.

Grammar tools that generate highlight.js modules produce exactly this
shape; Nexus does (`nexus --highlight all x.grammar editors`). Link the
generated file rather than copying it, and every regeneration is picked
up on the next print. For Rig:

```bash
mkdir -p ~/.config/rip/print/languages
ln -s ~/Data/Code/rig/editors/highlightjs/rig.js ~/.config/rip/print/languages/rig.js
rip-print src/
```

Every `.rig` file under `src/` now prints highlighted. The folder is
read by the `rip-print` command; the editor extension below keeps its
own built-in languages.

## VS Code / Cursor extension

[`vscode/`](vscode/) packages the same printer as an editor extension
(`rip-lang.print`): print the current file or a folder from the command
palette or context menus, with the same themes, sizing, markdown mode,
and Rip-aware highlighting. It is a standalone sub-package with its own
suite (`bun run test` from `vscode/`); the Rip grammar it ships is
generated from `packages/highlight` by `rip sync.rip` and byte-gated by
its tests.

## Test

```bash
bun run test
```

The suite pins the flag and error paths, file discovery, the served
page (chrome, highlighting, themes, headers), markdown mode, added
languages, and the shared-grammar divergences — every case runs the CLI as a real
subprocess with a stubbed browser opener.
