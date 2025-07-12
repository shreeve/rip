<div align="center">
  <img src="docs/assets/logos/rip-icon-512wa.png" alt="Rip Logo" width="200">
</div>

# Rip Language Packs (.ripz Bundles)

## Overview

Rip language packs are self-contained, distributable bundles (with the `.ripz` extension) that contain everything needed to parse, highlight, and work with a programming language in the Rip ecosystem. They enable fast runtime loading, easy distribution, and powerful modding/customization workflows.

---

## What is a .ripz Language Pack?

A `.ripz` file is a compressed archive (e.g., zip or tar+gzip) that contains:
- **Compiled parser tables/code** (for fast runtime)
- **Raw grammar file** (for editing, auditing, or recompiling)
- **Syntax highlighting definitions** (e.g., TextMate, Prism, Monaco, etc.)
- **Snippets, code templates, or language-specific settings**
- **Metadata** (name, version, author, license, etc.)
- **Docs, README, or usage notes**
- **Test cases or sample code**
- **Custom extensions or plugins**

A language pack is fully self-contained: you can distribute just the `.ripz` file, and it will work out of the box for parsing, highlighting, and more.

---

## Directory Structure and Workflow

### Distribution/Production
- `/languages/coffeescript.ripz` (and other `.ripz` files) are all you need to run and parse programs in those languages.
- No need for separate raw files unless you want to modify or extend the language.

### Modding/Development
- To customize a language, **unpack** the `.ripz` file into `/languages/mods/{lang-name}/`.
- Edit the grammar, highlighting, or any other component in the mod directory.
- When ready, **repack** the modded files into a new `.ripz` bundle with a CLI command (e.g., `rip --repack-language coffeescript`).
- You can delete the `/languages/mods/{lang-name}/` directory at any time to revert to the original pack.

#### Example:
```
/languages/
  coffeescript.ripz
  python.ripz
  ...
/languages/mods/coffeescript/
  grammar.coffee
  highlight.tmLanguage.json
  README.md
  ...
```

---

## Runtime and CLI Behavior

- **Default:**
  - The runtime loads `/languages/{lang}.ripz` directly for speed.
- **Mod Mode:**
  - If `/languages/mods/{lang}/` exists, the runtime uses the raw files in that directory for parsing and development.
  - When you are satisfied with your changes, run `rip --repack-language {lang}` to create a new `.ripz` bundle from your modded files.
  - You can delete the mod directory to revert to the distributed pack.
- **Staleness Check:**
  - The runtime can check timestamps or hashes to determine if the modded files are newer than the `.ripz` bundle and prompt for repacking if needed.
- **Force Repack:**
  - Use a CLI flag like `--repack-language` to force a rebuild of the `.ripz` file from the mod directory.

---

## Bundle Format

A `.ripz` file is a compressed archive (zip, tar.gz, or similar) with a structure like:
```
coffeescript.ripz
├── grammar.coffee
├── parser.json
├── highlight.tmLanguage.json
├── README.md
├── meta.json
└── ...
```
- `grammar.coffee`: The raw grammar definition
- `parser.json`: Compiled parser tables/code
- `highlight.tmLanguage.json`: Syntax highlighting
- `meta.json`: Metadata (name, version, author, etc.)
- `README.md`: Documentation or usage notes

---

## CLI Commands (Proposed)

- `rip pack /languages/mods/coffeescript/ -o /languages/coffeescript.ripz`
  Assemble a `.ripz` bundle from a mod directory.
- `rip unpack /languages/coffeescript.ripz -d /languages/mods/coffeescript/`
  Extract a `.ripz` bundle for editing.
- `rip --repack-language coffeescript`
  Repack the modded files into a new `.ripz` bundle.
- `rip info /languages/coffeescript.ripz`
  Show metadata and contents of a bundle.
- `rip extract-raw /languages/coffeescript.ripz`
  Extract the raw grammar from a bundle.

---

## Benefits

- **Self-contained:** Everything for a language in one file
- **Portable:** Easy to share, distribute, or version-control
- **Hackable:** Anyone can extract, tweak, and repack a language
- **Extensible:** Add new features (highlighting, snippets, docs) without changing the core loader
- **Clean workspace:** Mods are isolated; easy to reset or experiment
- **Transparency:** Always know exactly what grammar and settings were used to generate a parser
- **Reproducibility:** Anyone can regenerate or audit the parser from the embedded source
- **Customization:** Users can “pop open” a language pack, tweak the grammar, and recompile

---

## Example Workflow

1. **Unpack a language pack for modding:**
   ```bash
   rip unpack /languages/coffeescript.ripz -d /languages/mods/coffeescript/
   ```
2. **Edit the grammar, highlighting, or other files in `/languages/mods/coffeescript/`.**
3. **Repack the language pack:**
   ```bash
   rip --repack-language coffeescript
   ```
4. **Delete the mod directory to revert:**
   ```bash
   rm -rf /languages/mods/coffeescript/
   ```

---

## Future Possibilities

- **Plugin support:** Add plugins or extensions to language packs
- **Multiple highlight formats:** Support for VSCode, Monaco, Prism, etc.
- **Embedded test suites:** Ship test cases for language validation
- **Online sharing:** Upload/download `.ripz` packs from a central registry
- **Versioning:** Built-in version management and changelogs

---

## Summary

Rip language packs (`.ripz` bundles) are the foundation of a modern, hackable, and portable language ecosystem. They make it easy to distribute, customize, and extend languages—whether you’re a language designer, a power user, or just want to tweak your favorite syntax. The mod workflow ensures you can always experiment safely, and the CLI makes it easy to pack, unpack, and manage your language packs.