<img src="assets/logos/rip-icon-512wa.png" style="width:50px;float:left;" /><br>

# Quickstart

Welcome to Rip! This guide will help you get up and running quickly.

## Installation

```bash
# Install dependencies (if any)
# For Bun:
bun install
# For Node.js:
npm install
```

## Generating a Parser

```bash
# Generate a parser from a grammar file
coffee rip.coffee grammar.coffee -o parser.js

# With optimization and analysis
coffee rip.coffee grammar.coffee --optimize --stats --verbose

# Interactive exploration mode
coffee rip.coffee grammar.coffee --interactive

# Production-ready parser (no console output)
coffee rip.coffee grammar.coffee --production -o parser.js
```

## Running Your First Program

```bash
rip my-program.rip     # Run Rip language (CoffeeScript-like syntax)
rip my-program.coffee  # Run CoffeeScript via language pack
rip my-program.py      # Run Python via language pack (future)
rip my-program.js      # Run JavaScript via language pack (future)
```

## Troubleshooting

- If you encounter issues, check your grammar file for syntax errors.
- Use the `--stats` and `--verbose` flags for more detailed output.
- For help, see the [full documentation](./README.md) or open an issue on GitHub.

---

For more advanced usage, see the other docs in this folder!