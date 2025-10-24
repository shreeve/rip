# Rip is Bun-First! 🚀

## The Vision

Rip is designed from the ground up to be **dead simple** with Bun, while still working beautifully in browsers, Deno, and Node.js.

## 🎯 One Import. That's It.

### For Bun Projects

```toml
# bunfig.toml
[bun]
preload = ["rip/bun"]
```

```typescript
// app.ts - Just import .rip files!
import { greet, calculate } from './utils.rip'

console.log(greet('Bun'))
```

**That's the entire setup.** No build step, no compilation, no webpack, no vite, no nothing.

### For Quick Scripts

```javascript
import { compile } from 'rip'

const js = compile(`greet = (name) -> "Hello, #{name}!"`)
```

**One import, one function.** Rip source goes in, JavaScript comes out.

### For Browsers

```html
<script type="module">
  import Rip from 'rip/browser'

  Rip.run(`console.log 'Hello from Rip!'`)
</script>
```

**Works in any modern browser.** No build, no bundler, just load and run.

## 🏗️ Clean Architecture

```
YOUR CODE
    ↓
┌─────────────────┐
│  Import Layer   │  ← index.rip, simple.rip, browser.rip (thin!)
├─────────────────┤
│   Core Layer    │  ← rip.rip (compiler implementation)
├─────────────────┤
│ Implementation  │  ← lexer.rip, nodes.rip, grammar.rip
└─────────────────┘
```

**Why separate `rip.rip` from `index.rip`?**

Because:
- `rip.rip` = 317 lines of core compiler logic
- `index.rip` = 11 lines of re-exports
- `simple.rip` and `browser.rip` both import from `rip.rip`
- Clean separation = better maintainability

**The thin entry points are a FEATURE!** They show proper separation of concerns.

## 🚀 Usage Patterns

### Pattern 1: Bun Development (Recommended)

```bash
# Setup once
echo '[bun]\npreload = ["rip/bun"]' > bunfig.toml

# Write Rip files
echo 'export greet = (name) -> "Hello, #{name}!"' > app.rip

# Use directly
bun run main.ts  # imports app.rip - just works!
```

### Pattern 2: Build-Free Scripting

```javascript
// script.js
import { compile } from 'rip'

const ripCode = await Bun.file('app.rip').text()
const jsCode = compile(ripCode)
eval(jsCode)
```

### Pattern 3: Browser Playground

```html
<script type="module">
  import Rip from 'rip/browser'

  // Run code from string
  Rip.run(`
    data = await fetch('/api/data')!
    json = await data.json()!
    console.log json
  `)

  // Or load external file
  await Rip.load('./components/Header.rip')
</script>
```

### Pattern 4: Library Publishing

```json
{
  "name": "my-rip-library",
  "scripts": {
    "build": "rip -c -o dist src/*.rip"
  },
  "main": "./dist/index.js"
}
```

Compile Rip to JavaScript, publish JavaScript. Users don't need Rip installed.

## 📦 What Gets Installed

```
node_modules/rip/
├── lib/rip/
│   ├── index.js       ← Main entry (import Rip from 'rip')
│   ├── browser.js     ← Browser API (import Rip from 'rip/browser')
│   ├── loader.js      ← Node.js loader
│   ├── rip.js         ← Core implementation
│   └── [other files]
├── bin/rip            ← CLI
└── package.json
```

**Tiny footprint.** No dependencies. Just pure JavaScript.

## ⚡ Performance

### Bun Plugin (Fastest)

```bash
# With bunfig.toml preload
bun run app.ts  # Imports .rip files at native speed
```

Bun compiles `.rip` → JS on-the-fly with **zero overhead**.

### Direct Compilation (Fast)

```javascript
import { compile } from 'rip'
compile(source)  // Compiles instantly
```

No external processes, no file I/O during compilation.

### Browser (Dynamic)

```javascript
import Rip from 'rip/browser'
Rip.run(source)  // Compiles and runs
```

Perfect for playgrounds, REPLs, and interactive demos.

## 🎨 Language Features

```rip
# Clean syntax
square = (x) -> x * x

# Async with !
data = fetch('/api')!
json = data.json()!

# Array comprehensions
evens = (x for x in [1..100] when x % 2 is 0)

# Destructuring
{name, email} = user
[first, ...rest] = array

# Ruby-style regex
email =~ /^([^@]+)@(.+)$/
[user, domain] = _[1], _[2]

# Everything is an expression
status = if online then 'active' else 'offline'
```

## 🔧 Build Integration

### Vite (Future)

```javascript
import rip from 'vite-plugin-rip'

export default {
  plugins: [rip()]
}
```

### esbuild (Future)

```javascript
import ripPlugin from 'esbuild-plugin-rip'

await build({
  plugins: [ripPlugin()]
})
```

### For Now: Use Bun!

Bun is the primary target. It's the fastest, simplest way to use Rip.

## 🎯 Design Philosophy

1. **Bun First** - Native Bun integration is the priority
2. **Universal Second** - But still works everywhere
3. **Zero Config** - One line to enable
4. **No Build Step** - Import .rip files directly
5. **Fast Compilation** - Instant feedback
6. **Clean Output** - Modern ES6+ JavaScript

## 📊 Comparison

### Traditional TypeScript Project

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install          # Downloads 400MB of node_modules
npm run dev          # Starts dev server with build step
```

### Rip + Bun Project

```bash
echo '[bun]\npreload = ["rip/bun"]' > bunfig.toml
bun add rip         # Tiny package, no dependencies
bun run dev.ts      # Just runs, no build
```

**400MB vs 2MB. Build step vs direct execution.**

## 🚀 Getting Started

```bash
# 1. Install
bun add rip

# 2. Configure (one line!)
echo '[bun]\npreload = ["rip/bun"]' > bunfig.toml

# 3. Write Rip
cat > app.rip << 'EOF'
export greet = (name) ->
  "Hello from Rip, #{name}!"
EOF

# 4. Use it!
bun -e "import {greet} from './app.rip'; console.log(greet('Bun'))"
```

**That's it. You're done.**

## 📚 Learn More

- [Usage Guide](./USAGE.md) - Comprehensive patterns
- [Architecture](./ARCHITECTURE.md) - Why the code is structured this way
- [Examples](./examples/) - Working examples

## 💡 Philosophy

Rip embraces:
- **Simplicity** over complexity
- **Convention** over configuration
- **Performance** through Bun
- **Universality** through clean ES6 output

We reject:
- 400MB node_modules
- Complex build pipelines
- Dependency hell
- Configuration fatigue

## 🎉 The Result

**One line of config. Zero build step. Import .rip files. Ship fast.**

That's the Rip way. That's Bun-first development.

---

Built with ❤️ for developers who value simplicity
