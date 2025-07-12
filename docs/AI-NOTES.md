# AI-NOTES.md

## Code Style: Object Literal Alignment (Configuration Blocks)

**Policy:**
For all configuration-style object literals (and similar blocks), align the following elements vertically for maximum readability:

- The colons (`:`) after each key
- The start of the value expressions
- The `?` (ternary) operators, if present

This style should be applied throughout the codebase unless a specific block is intentionally overridden for a different reason.

**Example (Preferred Style):**

```coffeescript
@optimizationConfig =
  enabled:          opts.optimize         ? false
  auto:             opts.autoOptimize     ? true
  minStatesForAuto: opts.minStatesForAuto ? 20
  algorithms:       opts.algorithms       ? ['auto']
  skipIfSmall:      opts.skipIfSmall      ? true
```

**Guidelines:**
- Use as many spaces as needed so that all colons, value expressions, and `?` operators are in vertical columns.
- This applies to any object literal where multiple keys share a similar value pattern (especially ternary or config blocks).
- If a block is intentionally not aligned this way, add a comment explaining why.

**Purpose:**
- To maximize clarity and maintainability for both humans and AI tools.
- To provide a clear, machine-readable style guide for future AI assistants or code formatters.

---

*This file is intended for AI and human developers to understand and enforce project-specific code style conventions. Update as new conventions are established.*