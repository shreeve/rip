# middleware

Application-owned request policy:

- `use(middleware)` composes Web-standard `(request, next)` functions in
  registration order;
- CORS validates exact origins, handles preflight, and rejects wildcard
  credentials;
- sessions require a secret and support authenticated signed cookies or
  AES-256-GCM encrypted cookies;
- `session` is isolated by `AsyncLocalStorage`, including concurrent requests;
- CSRF uses a signed double-submit cookie and constant-time header comparison.
- `htmlJson` renders direct iOS JSON navigation as escaped highlighted HTML
  while API requests retain JSON; its representation inputs are all in `Vary`.

Compression, baseline security headers, transport deadlines, static files, and
access logging are edge responsibilities and do not enter this fixture.
