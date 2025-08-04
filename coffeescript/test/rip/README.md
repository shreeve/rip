# rip Test Suite

This directory contains tests specific to **rip's modernization features**.

## Philosophy

- **Inheritance**: The main `test/` directory contains CoffeeScript's original 1473 tests, proving compatibility
- **Innovation**: This `test/rip/` directory contains new tests for rip's modern features
- **Separation**: Clear distinction between "what we inherited" vs "what we added"

## Test Categories

- `modern-output.coffee` - Tests for clean, modern JavaScript output
- `bare-mode.coffee` - Tests for IIFE-free compilation
- `future-features.coffee` - Tests for upcoming ES6+ features
- `regression.coffee` - Tests to prevent regressions in modernization

## Language Notes

### Range Syntax
CoffeeScript's range operator `..` creates arrays and doesn't support open-ended ranges:
- `1..10` creates `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]`
- `5..` is **not valid** CoffeeScript syntax
- `..20` is **not valid** CoffeeScript syntax

For DSLs needing range constraints, consider alternatives like:
- Array notation: `[3, 50]` for "3 to 50"
- Use `null` for unbounded: `[0, null]` for "0 or more"
- String notation: `'3..50'`, `'0..'`, `'..100'`

## Running Tests

```bash
# Run original CoffeeScript compatibility tests
npm test

# Run rip-specific modernization tests
./bin/cake test:rip
```