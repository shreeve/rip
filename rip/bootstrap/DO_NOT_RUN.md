# ⚠️ DO NOT RUN THE BOOTSTRAP COMPILER ⚠️

The bootstrap compiler in this directory is a simplified Rip-to-JS compiler that was used to initially bootstrap the Rip language. However, it has significant limitations:

## Problems:
1. **Corrupts complex JS files** - It cannot properly handle default parameters, spread operators, and other advanced JS features
2. **Breaks Solar** - The Solar parser generator gets corrupted when processed by the bootstrap
3. **Breaks Nodes** - The AST node definitions get corrupted

## Current Status:
- **Solar.js** - Compiled using CoffeeScript 2.7.0 and manually fixed for ES6
- **nodes.js** - Hand-written ES6 module
- **grammar.js** - Hand-written ES6 module

## DO NOT RUN:
- `bun bootstrap/rip-bootstrap.js` - This will corrupt the lib files!

## Instead Use:
- The working Solar parser generator: `bun test/test-solar.js`
- CoffeeScript for compiling `.coffee` files if needed
- Hand-edit `.js` files in lib/ directory

Once Rip is fully self-hosting, we can remove this bootstrap directory entirely.
