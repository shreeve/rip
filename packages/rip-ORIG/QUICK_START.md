# Rip Quick Start 🚀

## Browser (Easiest!)

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Step 1: Include the browser module -->
  <script type="module" src="./node_modules/rip/lib/rip/browser.js"></script>
</head>
<body>
  <!-- Step 2: Write Rip code! -->
  <script type="text/rip">
    x = (y for y in [2..5] when y isnt 3)
    console.log 'Result:', x
  </script>
</body>
</html>
```

**That's it!** Your Rip code runs automatically.

See [BROWSER_TAGS.md](./BROWSER_TAGS.md) for full docs.

## Bun Projects

```bash
# 1. Add to bunfig.toml
echo '[bun]\npreload = ["rip/bun"]' > bunfig.toml

# 2. Import .rip files
import { greet } from './app.rip'
```

## Simple Compilation

```javascript
import { compile } from 'rip'

const js = compile(`greet = (name) -> "Hello, #{name}!"`)
console.log(js)  // JavaScript output
```

## Full Documentation

- [USAGE.md](./USAGE.md) - Complete usage guide
- [BROWSER_TAGS.md](./BROWSER_TAGS.md) - Browser tags documentation
- [BUN_FIRST.md](./BUN_FIRST.md) - Bun-first development
- [examples/](./examples/) - Working examples
