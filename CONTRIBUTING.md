<img src="/assets/logo.png" style="width:50px" />

# Contributing to Rip

Thank you for your interest in contributing! This guide summarizes environment setup, development workflows, code style, testing, and PR guidelines.

## Environment Setup

Prerequisites:
- Bun (preferred)
- Git

Compiler build:
```bash
cd coffeescript
cake build
./bin/coffee --version
```

## Development Workflows

Compiler:
```bash
cd coffeescript
cake build                 # Rebuild after changes
npm test                  # Full test suite (CoffeeScript + Rip)
./bin/cake test:rip       # Only Rip feature tests
./bin/coffee -c file.rip  # Compile .rip
```

Server (per-worker sockets):
```bash
bun server apps/labs/api http:5002 w:4 --hot-reload=process
bun packages/server/rip-server.ts --stop   # stop prior instances
```

API utilities:
```bash
bun packages/api/test-toName.rip
```

## Code Style
- Follow existing CoffeeScript indentation (2 spaces)
- TypeScript for packages/tooling
- Use meaningful names; comment complex regex/AST code
- Keep generated JavaScript clean and modern

## Naming Conventions
- RIP (uppercase): environment vars (`RIP_LOG_JSON`, `RIP_HOT_RELOAD`)
- Rip (title case): docs and user-facing references
- rip (lowercase): CLI, package names, file extensions

## Testing
```bash
cd coffeescript && npm test            # full suite
cd coffeescript && ./bin/cake test:rip # rip features only
cd coffeescript && ./bin/coffee test/rip/enhanced-regex-match.coffee
```
- Place Rip tests under `coffeescript/test/rip/`
- Test edge cases and generated JS
- Maintain compatibility with CoffeeScript tests

## PR Guidelines
- Branch: `feat/*`, `fix/*`, `refactor/*`
- Conventional commits (feat/fix/refactor/docs)
- Before PR:
  1) Run full tests
  2) Verify Rip tests
  3) Inspect generated JS
  4) Update docs when needed

## Quick Links
- Architecture: ARCHITECTURE.md
- Branding: BRANDING.md
- Unified Server: packages/server/

## For AI Agents
- Preserve CoffeeScript compatibility
- Always run tests before changes
- Test regex features across data types
- Keep generated JS clean and performant

---
Thanks for helping make Rip better!
