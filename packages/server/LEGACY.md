# Rip Server Legacy Nuggets

This file preserves non-obvious, still-useful ideas from legacy docs.

Use it as a checklist of concepts to consider porting into the new `packages/server` implementation.

## HTTPS and Certificate Authority (CA)
- Dev CA layout under `~/.rip-server/`:
  - `ca/` (root CA: `root.crt`, `root.key`)
  - `certs/` (per-domain: `<domain>.crt`, `<domain>.key`, `<domain>.csr`)
  - `run/` (runtime artifacts as needed)
- Modes to support when adding HTTPS to the new server:
  - `https:quick`: generate a self-signed cert on demand
  - `https:ca`: generate a CA-signed cert (using our dev CA)
  - `https` (smart): prefer CA if present, else quick
  - Optional: allow explicit cert/key file paths
- CA commands worth preserving (CLI subcommands):
  - `ca:init`: create root CA (openssl, RSA 3072, ~2 years validity)
  - `ca:trust` (macOS): add root cert to login keychain as trusted
  - `ca:export`: export `root.crt` for manual import/automation
  - `ca:info`, `ca:list`, `ca:clean`: inspection and housekeeping
- Implementation notes:
  - Use `Bun.spawn` for openssl steps; keep logic idempotent
  - macOS trust: `security add-trusted-cert -d -r trustRoot -k ~/Library/Keychains/login.keychain-db ~/.rip-server/ca/root.crt`
  - Add HTTPS listener alongside HTTP using the same fetch handler
- curl note for dev:
  - curl uses its own CA store; for dev either use `-k` or `--cacert <exported-ca.crt>`

## Deployment strategy idea
- Blue–green swap: pre-spawn new generation, readiness probe, atomic balancer swap, drain old generation

## CLI Ergonomics (optional future polish)
- HTTPS modes and tokens:
  - `http`, `https`, `http+https`; `https:quick`, `https:ca`
- Auto port probing/bump for HTTP/HTTPS (avoid collisions in dev)



## Security/HTTP Hardening Ideas (roadmap)
- Optional HTTP→HTTPS redirect flag; HSTS toggle for dev; body size/timeouts presets
- Future: HTTP/2 (ALPN), OCSP stapling; basic rate-limit; static file helper with gzip/brotli + caching controls
- Optional NCSA access log format + rotation (ops-friendly)



---

## Legacy TS Snippets (for reference)

### HTTPS/TLS serve
```ts
// Example Bun HTTPS server (from legacy/server.ts)
const httpsServer = Bun.serve({
  port: httpsPort,
  tls: { cert, key },
  fetch: handleRequest,
})
```

### CA/HTTPS Concepts
- RIP_CONFIG_DIR = ~/.rip-server
- CA_DIR = ~/.rip-server/ca
- CERTS_DIR = ~/.rip-server/certs
- Helpers to consider: `hasCA()`, `ensureDirectories()`,
  `generateCACert(domain) -> { cert, key }`, `generateSelfSignedCert() -> { cert, key }`
- CLI: `ca:init`, `ca:trust`, `ca:export`, `ca:info`, `ca:list`, `ca:clean`
