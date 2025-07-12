<img src="assets/logos/rip-icon-512wa.png" alt="Rip Logo" width="50" align="left"/>

# Runtime Engine

This document provides a deep technical dive into the Rip universal runtime engine: how the parser works, the execution flow, and how you can extend or hack the internals.

## Overview

Rip’s runtime engine is a compact, high-performance LALR(1) parser and execution environment. It is designed to be language-agnostic, loading language packs to support any syntax and semantics.

- **Universal Runtime:** One engine, many languages
- **Table-Driven Parsing:** Fast, reliable, and extensible
- **Execution Flow:** From source code to AST to execution

## Table of Contents
- [Parser Internals](#parser-internals)
- [Execution Flow](#execution-flow)
- [Advanced Topics](#advanced-topics)
- [Related Docs](#related-docs)

## Parser Internals

<!-- Merge content from PARSER.md here: data structures, state machine, actions, etc. -->

## Execution Flow

<!-- Merge content from RIP-PARSER-EXECUTION-FLOW.md here: step-by-step flow, diagrams, etc. -->

## Advanced Topics
- State minimization
- Conflict resolution
- Error recovery
- Table compression

## Related Docs
- [How It Works](./how-it-works.md)
- [Grammar Authoring](./grammar-authoring.md)

---

For a high-level overview, see [how-it-works.md](./how-it-works.md).