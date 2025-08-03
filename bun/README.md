<img src="/assets/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Bun - Seamless Language Transpilation

**Transform .rip Files to JavaScript with Zero Configuration**

## 🎯 What it does

- Automatically transpiles `.rip` files when imported
- Integrates with Bun's plugin system
- Preserves source maps for debugging
- Zero configuration required

## 🔧 How to use

### 1. Configure in `bunfig.toml`

```toml
preload = ["/path/to/bun/rip-bun.ts"]
```

### 2. Import `.rip` files directly

```javascript
import app from './app.rip'
import { schema } from './schema.rip'
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