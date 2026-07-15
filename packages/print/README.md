# @rip-lang/print

Syntax-highlighted source code printer. Highlights source files with
highlight.js (190+ languages), serves the result once on
`http://localhost:9111/`, opens the browser, and exits — no leftover
files, no cleanup. Rip files highlight through the repository's shared
grammar (`@rip-lang/highlight`).

This is a pure CLI package: `print.rip` is the whole program and there
is no library export surface.

## Usage

```bash
rip-print src/                # Print all source files in src/
rip-print a.rip b.js          # Print specific files
rip-print -d src/             # Dark theme (default: light)
rip-print -b src/             # Strip leading comment blocks
rip-print -x lock,map src/    # Exclude extensions
rip-print notes.md            # A single .md renders as a document
```

Options:

- `-b, --bypass` — strip leading comment blocks from files
- `-d, --dark` — dark theme (default: light)
- `-h, --help` — usage
- `-v, --version` — version
- `-x <exts>` — comma list of extensions to exclude

## What you get

- Per-file sections with line numbers, language tags, and mtime stamps
- A two-column table of contents (when printing more than one file)
- prev / next / top navigation between files
- A 14-theme switcher (7 light, 7 dark) and S/M/L font sizing, both
  remembered in `localStorage`
- Print-ready CSS (`@media print` styling, exact color adjustment)
- `<script type="text/rip">` blocks inside HTML files re-highlighted
  as Rip
- A single `.md` argument renders the markdown as a document instead
  of showing its source (`-d` force-darkens it)

Directory walks skip dotfiles, `.git`, `node_modules`, `dist`, other
generated trees, and binary/lock extensions by default; `-x` extends
the exclusion list.
