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

## Running Tests

```bash
# Run original CoffeeScript compatibility tests
npm test

# Run rip-specific modernization tests
./bin/cake test:rip
```