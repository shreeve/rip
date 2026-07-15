# @rip-lang/gate

A bouncer for `@rip-lang/server`. Its only job: make sure nobody reaches your app without authenticating first. There is **zero interaction** between the gated app and the gate — the app just sees an authenticated request (and, behind a proxy, a `Remote-User` header).

Sessions are deliberately boring: a 128-bit random token in a cookie, backed by a file on disk. Argon2id passwords. One middleware.

## How sessions work

On login, gate mints an unguessable 22-char base64url token and writes a file named after it (contents = the username) under a private session dir. "Is this session valid?" is one `stat`: the file exists and its mtime is within `ttl`.

- **No encryption, no signing.** An unguessable token *is* the proof; the filesystem is the source of truth. The cookie carries no PII.
- **Real server-side revocation** — the thing a stateless encrypted cookie can't give you:
  - log out / kill one session → `rm <dir>/<token>` (the `POST /_gate/logout` route does this)
  - kick everyone → `rm <dir>/*`
- **Sliding idle timeout** — each authed request bumps the file's mtime, so active users stay in; idle ones past `ttl` read as expired and are swept lazily.
- **Ephemeral by default** — sessions live in `/tmp/rip-gate`, so a reboot simply forces re-login (a feature for an auth gate, and no root needed).

The single `secret` is used **only** to HMAC-sign the login/logout CSRF token. It encrypts nothing. It is present-and-strong (32+ chars) or absent-with-explicit-`insecure: true` — the same fail-hard contract as the server's `security.rip`; a weak secret throws at construction, and the `insecure` opt-out mints a random per-boot key (dev only — a restart invalidates in-flight login forms).

## Usage

`gate(opts)` returns **one middleware** for the server's `compose()` pipeline. It answers the `/_gate/{check,login,logout}` endpoints itself and guards everything else. (v3 registered those routes on the server's ambient route table; v4's server is pure decision cores with no ambient registry, so the endpoints dispatch inside the middleware — same requests, same responses.)

```coffee
import { compose } from '@rip-lang/server'
import { gate } from '@rip-lang/gate'

run = compose
  use: [gate
    secret: process.env.GATE_SECRET
    users:
      alice: '$argon2id$v=19$m=65536,t=2,p=1$...'
  ]
  handler: app   # everything behind the gate

response = await run createContext(request)
```

Unauthenticated browser requests redirect to `/_gate/login`; API requests (no `Accept: text/html`) get `401`. Once past the gate, your handlers run normally. Gate keeps **no shared session** with your app — it's purely a bouncer. If a handler needs to know *who* the user is, run gate in forward-auth mode behind a proxy and read the `Remote-User` header the proxy copies from `/_gate/check`.

Generate an Argon2id hash for the `users` map:

```bash
bin/rip packages/gate/index.rip hash 'hunter2'
# or: bun -e "console.log(await Bun.password.hash(process.argv[1], { algorithm: 'argon2id' }))" 'hunter2'
```

## Forward-auth behind a reverse proxy

For protecting non-Rip apps (Incus, third-party tools), serve gate as its own little app (`protect: 'none'` exposes only the `/_gate/*` endpoints) and let the front proxy ask `/_gate/check` whether each request is allowed.

> v3 shipped a zero-config standalone bootstrap (`rip server packages/gate` reading `GATE_*` env vars). v4's server has no runnable serving layer yet, so that bootstrap is not ported — wire the composed pipeline into your listener until it lands.

### Caddy

```caddyfile
app.example.com {
  # /_gate/* is gate's UI surface (login, logout confirmation).
  handle /_gate/* {
    reverse_proxy 127.0.0.1:9090
  }

  # Everything else is auth-gated, with the protected app's identity
  # populated from gate's Remote-User response header. The pre-auth
  # request_header strip prevents clients from spoofing it.
  handle {
    request_header -Remote-User
    forward_auth 127.0.0.1:9090 {
      uri /_gate/check
      copy_headers Remote-User
    }
    reverse_proxy 127.0.0.1:3000
  }
}
```

### nginx

`ngx_http_auth_request_module` only treats `2xx` as allow and `401`/`403` as deny — any `3xx` from the auth endpoint becomes a `500`. Two adjustments make Gate work with it:

1. Send `Accept: application/json` on the subrequest so Gate returns `401` (not its browser-friendly `302`).
2. Wire `error_page 401` to a named location that redirects to `/_gate/login`.

```nginx
server {
  listen 443 ssl;
  server_name app.example.com;
  # ... TLS config ...

  # Gate's UI surface
  location /_gate/ {
    proxy_pass http://127.0.0.1:9090;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Internal subrequest endpoint for auth_request
  location = /_gate/auth {
    internal;
    proxy_pass                       http://127.0.0.1:9090/_gate/check;
    proxy_pass_request_body          off;
    proxy_set_header Content-Length  "";
    proxy_set_header X-Forwarded-Uri    $request_uri;
    proxy_set_header X-Forwarded-Method $request_method;
    proxy_set_header X-Forwarded-Host   $host;
    proxy_set_header X-Forwarded-Proto  $scheme;
    proxy_set_header Cookie             $http_cookie;
    proxy_set_header Accept             "application/json";  # → Gate returns 401, not 302
  }

  # Protected app
  location / {
    proxy_set_header Remote-User "";   # strip client-supplied Remote-User
    auth_request                /_gate/auth;
    auth_request_set $remote_user $upstream_http_remote_user;
    error_page 401 = @gate_login;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Remote-User $remote_user;
    proxy_set_header Host        $host;
  }

  location @gate_login {
    return 302 /_gate/login?return_to=$request_uri;
  }
}
```

Traefik's `forwardAuth` and Envoy's `ext_authz` behave like Caddy (Gate's `302` forwards directly, no extra config).

## Options

| Option       | Default                                | Notes                                                                                  |
| ------------ | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `secret`     | (required)                             | CSRF signing key, 32+ chars — anything shorter **throws at construction**              |
| `insecure`   | `false`                                | Opt out of requiring a secret (dev only): gate mints a random per-boot key. Never excuses a weak `secret`. |
| `users`      | `{}`                                   | `{ username: argon2id-hash }` map                                                      |
| `verify`     | -                                      | `async (user, pass) -> {user, ...} \| null` — overrides `users` for custom backends    |
| `template`   | built-in HTML form                     | `({csrfToken, error, returnTo, host}) -> HTML` — bring your own login page             |
| `ttl`        | `28800` (8h)                           | Session lifetime in seconds                                                            |
| `secure`     | `NODE_ENV=production`                  | Force `Secure` cookie attribute                                                        |
| `cookieName` | `__Host-rip_gate` / `rip_gate`         | Override session cookie name                                                           |
| `protect`    | `'all'`                                | `'all'`: auto-redirect unauthenticated requests. `'none'`: only expose `/_gate/*`      |
| `sessionDir` | `$XDG_RUNTIME_DIR/rip-gate` or `/tmp/rip-gate` | Where token files live. Created `0700`, refuses a dir it doesn't own. Overridable via `GATE_SESSION_DIR`. |

`ttl` is an **idle** timeout (sliding): activity refreshes it. `verify` returning an object only uses its `.user` field (that's all gate stores and emits as `Remote-User`).

## Endpoints

- `GET /_gate/check` — for `forward_auth`. `204` + `Remote-User` if authenticated, else `302` (browser) or `401` (API).
- `GET /_gate/login` — renders the login form.
- `POST /_gate/login` — verifies credentials, sets session cookie, redirects to `return_to`.
- `GET /_gate/logout` — renders a tiny "Sign out as X" confirmation form (side-effect free).
- `POST /_gate/logout` — deletes the session's token file server-side (CSRF-required).

## Security model

What actually guards the app, and what doesn't:

- **Access control** rests on two things a hostile client can't beat by forging headers: the **password** (Argon2id) needed to get a session, and the **128-bit random token** needed to use one. `curl` with any headers it likes still hits those walls.
- **CSRF protection** is a separate concern — it protects honest *browser* users from a malicious third-party page abusing their cookie. It is never the access wall, so "but curl can fake `Origin`" doesn't matter: a direct attacker has no victim cookie to abuse. Gate uses a **signed double-submit cookie**: the CSRF token is `nonce.HMAC(secret, nonce)`, planted in both a cookie and the form's hidden `_csrf`; `POST` requires cookie == form **and** a valid HMAC. `SameSite=Lax` keeps the cookie off cross-site POSTs.

This is deliberately **not** the server's header-only `csrf()` middleware: the login page is a plain HTML form with no script to copy a cookie into a header, so the form-field double-submit stays. Compose gate **before** `csrf()` — gate answers `/_gate/*` itself, so the header-only rule never sees those POSTs — and gate's session is likewise independent of the server's `sessions()` cookie (same `HttpOnly`/`SameSite=Lax`/`Path=/`/`Secure` posture, different job).

Other defenses: server-enforced mtime TTL (a stolen-but-idle cookie expires server-side regardless of the browser), `Remote-User` is ASCII-validated before it's emitted, `return_to` is sanitized to a same-origin path, and unknown users cost the same Argon2id time as a wrong password (no timing enumeration).

## Notes

- **`Remote-User` trust:** the reverse proxy MUST strip any client-supplied `Remote-User` before the auth subrequest (the Caddy/nginx configs above do). Gate itself never reads that request header — identity only ever travels on gate's own `/_gate/check` *response* — and in middleware mode the gated app must not read it either.
- **Logout revokes server-side** — `POST /_gate/logout` deletes the token file, so a copy of the cookie captured beforehand stops working immediately. (A stolen cookie still works until *its* file is removed or expires — short `ttl` plus `rm` are your controls.)
- **Multi-user hosts:** `/tmp` is world-writable, so gate creates the session dir `0700` and refuses one it doesn't own (defeats symlink/pre-create tricks). On a dedicated server this is moot.
- Gate doesn't throttle login attempts — put it behind CrowdSec or Caddy `rate_limit` if you're exposed to the public internet.

## Files

- `index.rip` — the middleware (endpoints + guard) and the `hash` subcommand
- `test/` — the v3 behavior contract plus the port's security battery

That's the whole package.

## License

MIT
