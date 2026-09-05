<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Print

Syntax-highlighted source code printing for VS Code and Cursor.

Right-click a file, folder, or editor and choose **Rip Print** — a
print-ready, syntax-highlighted page opens in your browser. Rip sources
highlight through the repository's shared grammar, generated into this
extension by `rip sync.rip` (never hand-edited).

## Features

- Print the current file with beautiful syntax highlighting
- Print all files in a folder
- 14 color themes (7 light, 7 dark) with runtime switching
- Adjustable font sizes (S / M / L)
- Line numbers
- Table of contents for multi-file prints
- Print-optimized CSS (toolbar and navigation hidden when printing)
- Auto-detects light/dark mode from your editor theme
- Rip syntax highlighting inside `<script type="text/rip">` HTML blocks
- A single `.md` file renders as a document (via Bun) instead of source

## Usage

### Command Palette

- `Rip Print: Print Current File` — print the active editor file
- `Rip Print: Print Folder` — print all files in a selected folder

### Context Menus

- **Explorer**: Right-click a file or folder to print
- **Editor**: Right-click in the editor → Rip Print: Print Current File

## Supported Languages

40+ file extensions including JavaScript, TypeScript, Python, Rust, Go, Ruby,
C, C++, Zig, Rip, CoffeeScript, Bash, YAML, JSON, HTML, CSS, SQL,
Markdown, and more.

## Building

```bash
bun install
bun run sync                     # regenerate lib/hljs-rip.js from packages/highlight
bun run package                  # produces print-x.y.z.vsix
```

Install from the repository root:

```bash
bun run ext print vscode
bun run ext print cursor
bun run ext print both
```

Or, from this directory:

```bash
bun run install-vscode
bun run install-cursor
```

## Test

```bash
bun run test
```

The suite pins the manifest (commands, menus, engine, exact dependency
pin), byte-gates the generated grammar against `sync.rip`, and tests the
printer core directly: language detection, directory walking, the
generated print HTML, and markdown mode.
