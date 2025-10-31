# Rip - Bun-First JavaScript Compiler 🚀

**Unfancy JavaScript** - A modern, elegant language that compiles to clean JavaScript.

## 🎯 Dead Simple Usage

### For Bun (Recommended)

**One line of config:**

```toml
# bunfig.toml
[bun]
preload = ["rip/bun"]
```

**Then just import `.rip` files:**

```typescript
import { greet } from './app.rip'  // Just works!
```

### For Simple Compilation

**One import, one function:**

```javascript
import { compile } from 'rip'

const js = compile(`
  greet = (name) -> "Hello, #{name}!"
`)
```

## ✨ Language Features

```rip
# Clean, expressive syntax
greet = (name) -> "Hello, #{name}!"

# Async with ! operator
data = fetch(url)!
result = processData(data)!

# Array comprehensions
squares = (x * x for x in [1..10])

# Ruby-style regex matching
email =~ /^([^@]+)@(.+)$/
[username, domain] = _[1], _[2]

# Bracket regex indexing
domain = email[/@(.+)$/] and _[1]

# Null safety
name = user?.profile?.name ? 'Anonymous'

# Everything is an expression
result = if condition then 'yes' else 'no'

# Classes
class Animal
  constructor: (@name) ->
  speak: -> "#{@name} makes a sound"
```

## 📦 Installation

```bash
bun add rip
```

## 🚀 Quick Start

### Bun Project

```bash
# 1. Add to bunfig.toml
echo '[bun]\npreload = ["rip/bun"]' > bunfig.toml

# 2. Create a .rip file
echo 'export greet = (name) -> "Hello, #{name}!"' > app.rip

# 3. Import and use!
bun -e "import {greet} from './app.rip'; console.log(greet('Bun'))"
```

### Browser (Auto-Execute Tags)

```html
<!-- Include once - auto-detects and processes <script type="text/rip"> tags -->
<script type="module" src="./node_modules/rip/lib/rip/browser.js"></script>

<!-- Write Rip anywhere! -->
<script type="text/rip">
  x = (y for y in [2..5] when y isnt 3)
  console.log 'Hello from Rip!', x
</script>
```

### Browser (Manual/Programmatic API)

```html
<script type="module">
  import Rip from 'rip/browser'

  Rip.run(`
    console.log 'Hello from Rip in the browser!'
  `)
</script>
```

## 📚 API

### `rip/browser` - Complete Browser API

**Auto-processes `<script type="text/rip">` tags:**
```html
<script type="module" src="rip/browser.js"></script>

<!-- Runs automatically! -->
<script type="text/rip">
  console.log 'Hello from Rip!'
</script>
```

**Or use programmatically:**
```javascript
import Rip from 'rip/browser'

Rip.run(`console.log 'Manual execution'`)
```

See [BROWSER_TAGS.md](./BROWSER_TAGS.md) for full documentation.

### `rip` - Core Compiler API

```javascript
import { compile } from 'rip'

// Simple compilation (returns JavaScript string)
const js = compile(ripSource)

// With source maps (returns object)
const result = compile(ripSource, { sourceMap: true })
console.log(result.js)
console.log(result.sourceMap)
```

### `rip/browser` - Browser API

```javascript
import Rip from 'rip/browser'

// Compile
const js = Rip.compile(source)

// Run directly
Rip.run(source)

// Load file
await Rip.load('./app.rip')
```

**Advanced features:**

```javascript
import Rip from 'rip'

// Tokenize
const tokens = Rip.tokens(source)

// Parse to AST
const ast = Rip.nodes(source)

// Version
console.log(Rip.VERSION)
```

## 🎨 Examples

See the [`examples/`](./examples/) directory for working examples.

## 📖 Documentation

- [Usage Guide](./USAGE.md) - Comprehensive usage patterns
- [Browser Tags](./BROWSER_TAGS.md) - Auto-execute `<script type="text/rip">` tags
- [Bun First](./BUN_FIRST.md) - Bun-first development guide
- [Architecture](./ARCHITECTURE.md) - How Rip is structured

## 🏗️ Project Structure

```
src/
├── rip.rip      # Core compiler implementation
├── index.rip    # Main entry point
├── simple.rip   # Minimalist API
├── browser.rip  # Browser/Bun enhanced API
├── lexer.rip    # Tokenizer
├── grammar.rip  # Parser grammar
├── nodes.rip    # AST nodes
└── ...
```

## 🛠️ CLI

```bash
# Compile files
rip -c src/*.rip

# Compile to directory
rip -c -o lib src/*.rip

# Watch mode
rip -w src/*.rip

# Run directly
rip app.rip

# Print compiled output
rip -p app.rip
```

## 🧪 Testing

```bash
bun run test
```

## 🎯 Philosophy

Rip follows the **4 C's**:

1. **Correct** - Accurate, reliable, thoroughly tested
2. **Clear** - Easy to understand, well-documented
3. **Consistent** - Unified patterns throughout
4. **Concise** - Minimal, elegant code

## 🤝 Contributing

Issues and PRs welcome! See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## 📄 License

MIT

## 🌟 Why Rip?

- **Bun-First** - Native integration with the fastest JavaScript runtime
- **Zero Config** - One line in bunfig.toml
- **Clean Syntax** - Elegant, readable code
- **Modern Output** - Generates clean ES6+ JavaScript
- **Battle-Tested** - Built on proven CoffeeScript foundations
- **Fast** - Compiles instantly

---

Built with ❤️ for the Bun community
