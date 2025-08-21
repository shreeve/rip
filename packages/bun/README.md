<img src="/logo.png" style="width:50px" /> <br>

# Rip Bun - Seamless Language Transpilation

**Transform .rip Files to JavaScript with Zero Configuration**

## 🎯 What it does

- Automatically transpiles `.rip` files when imported
- Integrates with Bun's plugin system
- Preserves source maps for debugging
- Zero configuration required

## 🔧 How to use

### 1. Configure in `bunfig.toml`

**Monorepo Root Architecture** - Single configuration for entire project:

```toml
# Root bunfig.toml (recommended)
preload = ["./packages/bun/rip-bun.ts"]
```

**Note**: With our clean monorepo architecture, you only need ONE `bunfig.toml` file at the root. All apps and examples run from the monorepo root using relative paths.

### 2. Import `.rip` files directly

```javascript
import app from './app.rip'
import { schema } from './schema.rip'
```

### 3. Run your apps

```bash
# From monorepo root (recommended architecture)
bun examples/hello/index.rip
bun apps/labs/api/index.rip

# Or with the platform controller
bun server examples/hello
rip-server platform
```

## 🏗️ Architecture

The plugin uses Bun's plugin API to intercept `.rip` file imports and transpile them using the CoffeeScript compiler (which Rip is based on).

```typescript
Bun.plugin({
  name: 'rip-bun',
  setup({ onLoad }) {
    onLoad({ filter: /\.rip$/ }, async ({ path }) => ({
      loader: 'js',
      contents: compile(await Bun.file(path).text(), {
        bare: true,
        header: true,
        filename: path,
        inlineMap: true,
      }),
    }))
  },
})
```

## 📦 Dependencies

- CoffeeScript compiler (for Rip transpilation)
- Bun runtime

## 🚀 Performance

- Near-zero overhead
- Transpilation happens once at import time
- Cached by Bun's module system

## License

MIT

## Contributing

rip-bun is part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community