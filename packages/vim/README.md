<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip Vim

> **Vim syntax highlighting, indentation, and filetype support for Rip.**

Vim plugin for the [Rip](https://github.com/shreeve/rip) programming language.

**Runtime:** Vim / Neovim plugin (editor host). Not a Bun package import.

## Features

- **Syntax highlighting** — keywords, strings, numbers, operators, types, built-ins, comments
- **String interpolation** — `#{}` and `${}` with nested brace support
- **Comments** — line, `###` blocks (line-start only), and the `__DATA__` payload
- **Function calls** — `fetch(`, `.json(`, dammit (`name!`), and maybe dammit (`name?!()`)
- **Object keys** — `method:` and `optional?:`, including keys spelled with a value word (`{on: 2}`)
- **Declarations** — `x = 5`, readonly `x =! 5`, state `x := 0`, computed `x ~= y`
- **Function definitions** — `def name`, `name = ->`, and `name: ->`
- **Class / enum / interface** — name and extends capture
- **Reactive operators** — `:=`, `~=`, `~>`, `!>`, `<~`, `<=>`, `=!`
- **Type annotations** — single-colon `name: Type` and `type Name =` (`::` is prototype access, e.g. `String::trim`)
- **Regular expressions** — `/regex/` and `///heregex///` with interpolation, with Rip's regex-vs-division rule
- **Render blocks** — `#id` element shorthand reads as an id, not a comment
- **Auto-indentation** — indent/dedent for offside-rule blocks
- **Filetype settings** — 2-space soft tabs, fold-by-indent, `gf` navigation

Render-block tags, attributes and component names, and the schema DSL's field
vocabulary, are not yet highlighted — see [TODO.md](TODO.md).

## Install

**vim-plug:**

```vim
Plug 'shreeve/vim-rip'
```

**lazy.nvim (Neovim):**

```lua
{ "shreeve/vim-rip" }
```

**Pathogen:**

```bash
cd ~/.vim/bundle && git clone https://github.com/shreeve/vim-rip.git
```

**Vim packages (no plugin manager):**

```bash
mkdir -p ~/.vim/pack/languages/start
cd ~/.vim/pack/languages/start
git clone https://github.com/shreeve/vim-rip.git
```

## Plugin Structure

| File | Purpose |
|------|---------|
| `ftdetect/rip.vim` | Detect `*.rip` files and `#!/usr/bin/env rip` shebangs |
| `ftplugin/rip.vim` | Comment format, indentation, fold method, `suffixesadd` |
| `syntax/rip.vim` | Syntax highlighting rules |
| `indent/rip.vim` | Auto-indentation for offside-rule blocks |

## Links

- [Rip Language](https://github.com/shreeve/rip)
- [vim-rip on GitHub](https://github.com/shreeve/vim-rip)
- [VS Code Extension](../vscode)
