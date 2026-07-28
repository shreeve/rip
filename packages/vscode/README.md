# Rip for VS Code

Language support for **Rip** — full IntelliSense for `.rip` files: syntax highlighting, hover, completions, refactoring, and live type-checking.

## How it works

Rip compiles to TypeScript, and this extension puts the full TypeScript language service behind your `.rip` files. Every hover, completion, and error is TypeScript's own answer — computed by the native TypeScript 7 server (`tsgo`) and mapped back onto the Rip source you actually wrote. Just open a `.rip` file and you get `.ts`-quality IntelliSense — no `.ts` files, no build step, nothing to configure.

## Features

- **Hover & diagnostics** — inferred and declared types, and type errors, on your Rip source.
- **Completions & auto-import** — member and scope completions; accepting an import inserts an idiomatic Rip import line.
- **Go-to-definition, type definition & implementation** — within a file, across files (even ones you haven't opened), and into `.ts`/`.d.ts`.
- **Signature help** — parameter hints, including across `def` overloads.
- **Find references & rename** — across your whole program; rename is all-or-nothing, never a partial edit.
- **Code actions** — organize, sort, and remove-unused imports, and fix-all — preserving your own import style.
- **Semantic highlighting** — type-aware token colors.
- **Outline & workspace symbols** — one entry per declaration.
- **Document links** — clickable relative paths in comments.

## Requirements

**[Bun](https://bun.sh)** on your PATH — the language server runs on Bun.

## Configuration

None needed — the extension works out of the box. Two files tune it, and both are optional.

### `tsconfig.json`

Governs lib, target, and strict-mode checks on your typed code, exactly as it would for `.ts` files. Without one, sensible defaults apply.

### `package.json`

A `rip` block tunes the checker itself:

```json
{
  "rip": {
    "strict": true,
    "noCheck": ["legacy/**", "vendor/*.rip"]
  }
}
```

**`strict`** (default `false`) reports missing type annotations. Rip is gradually typed, so unannotated code is legal by default; turn this on to flag it. Code you *have* annotated is checked fully either way.

**`noCheck`** (default `[]`) silences type errors in files matching a glob, or a list of globs. Matched files stay in the program, so their exports still resolve for everything that imports them — the project-wide form of a per-file `# @ts-nocheck`. Handy for quieting untyped or legacy paths.
