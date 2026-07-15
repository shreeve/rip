# @rip-lang/http

Zero-dependency HTTP client for Rip — ky-inspired convenience over
native fetch.

One instance, callable directly or through method shortcuts, with JSON
body handling, automatic error throwing on non-2xx, retries with
exponential backoff and `Retry-After` support, timeouts, lifecycle
hooks, and reusable instances. Browser-safe: in a browser, relative
paths resolve against the page origin.

```coffee
import { http, HTTPError } from '@rip-lang/http'

# Simple GET
data = http.get!('https://api.example.com/users').json!

# POST with a JSON body
user = http.post!('https://api.example.com/users', json: { name: 'Alice' }).json!

# Reusable API client
api = http.create
  prefixUrl: 'https://api.example.com/v1'
  headers: { Authorization: "Bearer #{token}" }
  timeout: 5000
  retry: 3

users = api.get!('users').json!
```

## Methods

Every call returns a `Promise<Response>`.

```coffee
http(url, opts)       # generic request (GET by default)
http.get(url, opts)
http.post(url, opts)
http.put(url, opts)
http.patch(url, opts)
http.del(url, opts)   # DELETE
http.head(url, opts)
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `method` | string | `'GET'` | HTTP method (uppercased) |
| `json` | unknown | — | JSON-stringify the body, set `Content-Type: application/json` unless one is given |
| `body` | BodyInit | — | raw request body (`json` wins when both are given) |
| `headers` | HeadersInit | — | request headers |
| `prefixUrl` | string | — | base URL joined with the input path |
| `searchParams` | object/string/URLSearchParams | — | query parameters; object values stringify, `null`/`undefined` drop |
| `timeout` | number/false | `10000` | per-request timeout in ms; `false` disables |
| `retry` | number/object/false | `{ limit: 2 }` | retry policy |
| `throwHttpErrors` | boolean | `true` | throw `HTTPError` on non-2xx |
| `hooks` | Hooks | — | lifecycle hooks |

Native fetch options (`mode`, `credentials`, `cache`, `redirect`,
`referrer`, `referrerPolicy`, `integrity`, `keepalive`, `signal`) pass
through to `fetch()`. A caller's `signal` composes with the timeout;
a caller abort surfaces as `AbortError`, a timeout as `TimeoutError`.

## Errors

Non-2xx responses throw `HTTPError` carrying `response`, `request`, and
`options`; timeouts throw `TimeoutError` carrying `request`. Both
classes are named exports and live on every instance
(`http.HTTPError`, `http.TimeoutError`).

```coffee
try
  data = http.get!('https://api.example.com/missing').json!
catch err
  if err instanceof HTTPError
    console.log err.response.status
```

## Retries

Failed requests retry with exponential backoff
(`0.3 * 2^(attempt-1)` seconds, ~10% jitter) capped by `backoffLimit`,
honoring `Retry-After` headers (seconds or HTTP date). Defaults: limit
2; methods `GET`, `PUT`, `HEAD`, `DELETE`, `OPTIONS`, `TRACE`; statuses
408, 413, 429, 500, 502, 503, 504. Network errors retry on the same
method policy.

```coffee
res = http.get! url, retry: 5           # up to 5 retries
res = http.get! url, retry: false       # never retry
res = http.get! url,
  retry:
    limit: 3
    methods: ['GET', 'POST']
    statusCodes: [429, 503]
    backoffLimit: 10000
    delay: (attempt) -> attempt * 1000
```

## Hooks

| Hook | Arguments | Can return |
|---|---|---|
| `beforeRequest` | `(request, options)` | `Request` (replace), `Response` (short-circuit) |
| `afterResponse` | `(request, options, response)` | `Response` (replace) |
| `beforeRetry` | `({ request, options, error, retryCount })` | — |
| `beforeError` | `(error)` | `HTTPError` (replace) |

`error` in `beforeRetry` is the network error, or `null` for a
status-code retry.

## Instances

`http.create(opts)` builds an instance from scratch; `instance.extend(opts)`
inherits its defaults. Headers merge (child overrides), hooks
concatenate (parent first).

```coffee
api   = http.create prefixUrl: 'https://api.example.com/v1', headers: { 'X-API-Key': key }
admin = api.extend headers: { 'X-Admin': 'true' }
```

## Test

```sh
bun run test
```
