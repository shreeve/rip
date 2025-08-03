# 🚀 Rip API Example

A modern API built with Hono and the Rip Application Server.

## 📦 Installation

```bash
bun install
```

## 🏃 Running with rip-server

The recommended way is to use rip-server with its flexible argument system:

```bash
# Basic start (from this directory)
rip-server

# With options (in ANY order!)
rip-server 8080                    # Different port
rip-server w:5                     # 5 workers
rip-server prod                    # Production mode
rip-server w:4 r:20 8080          # Mix and match!
rip-server cert.pem key.pem       # HTTPS with your certs
rip-server 3443                   # HTTPS with auto-generated cert
```

## ⚙️ Configuration

This project includes rip-server configuration in `package.json`:

```json
{
  "rip-server": {
    "workers": 4,
    "requests": 20
  }
}
```

These defaults are used unless overridden on the command line.

## 🧪 Direct execution

You can also run the API directly with Bun:

```bash
bun run index.ts
```

## 📡 Endpoints

- `GET /` - Welcome message with timestamp
- `GET /health` - Health check (when using rip-server)
- `GET /info` - API information

This project was created using `bun init` in bun v1.2.18. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.