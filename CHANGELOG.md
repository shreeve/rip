# Changelog

Notable changes to this repository, newest first. Entries reference this
repository's pull requests.

## Unreleased

- TLS material resolution and SNI matching land, pure over injected
  adapters — no certificate or private key is ever committed. Material
  resolves by precedence (an explicit cert/key, then ACME, then a
  local dev CA); production requires real material, so a missing
  certificate is a startup failure, never silent plaintext and never a
  development cert. SNI is exact-over-wildcard-over-catch-all: a
  wildcard covers exactly one deeper label — never the apex or a
  two-level subdomain — and matching is case-insensitive with port and
  trailing dot normalized away, hardened against null-byte,
  fullwidth-dot, and port-strip smuggling. An SNI-only config is TLS
  (never a silent plaintext verdict), an entry missing its cert or key
  is dropped rather than served half-formed, and every malformed
  config fails loudly naming the fault. Key material is never logged
  (#102)

- The server gains its worker pool: `createPool({ spawn })` schedules
  jobs across a fixed worker set with bounded concurrency, a bounded
  queue (rejecting loudly at capacity and on a wait-timeout), a
  recycle policy, and graceful shutdown — host-free and deterministic
  because the worker body, clock, and timer are injected. A worker
  retires when its request budget or age is spent; its replacement
  spawns at once so there is no capacity gap, and it leaves only after
  its in-flight jobs drain, so a recycle never drops a request. A
  synchronous throw from a handle is caught and normalized (a
  misbehaving worker never wedges the pool), a removed worker is
  disposed through an optional `close()`, and non-finite config can't
  defeat the size floor. Defaults follow the operational profile:
  concurrency 1, queue 512 / 30 s, recycle at 10000 req / 3600 s (#101)

- The development watch transport lands as SSE, host-free over
  web-standard streams: `createWatch()` fans one revisioned event to
  every open connection. `reload()`, `css(hrefs)`, and `error(payload)`
  push to all clients; a client reconnecting with a stale
  `Last-Event-ID` is reloaded at once (last-known-good), a compile
  error is sticky and takes precedence over the behind-reload so a
  client never reloads into a broken build, and `css()` is the fast
  path — the one bundled `watchClient` swaps only the named
  stylesheets, no reload, no lost state. Hostile input is contained:
  payloads serialize single-line (no SSE frame injection), the client
  path is `JSON.stringify`'d (no script injection), a non-serializable
  error becomes a safe note instead of wedging the endpoint, malformed
  payloads normalize before the client, a closed connection drops its
  client at once, and the endpoint is GET-only (#100)

- Static and application serving arrives, pure over an injected
  filesystem host: `serveStatic({ root, host })` refuses every `..`
  climb above the root (403) and re-checks the resolved realpath
  against the root's realpath, so a symlink pointing outside is
  refused too; the trailing-slash redirect is rebuilt from normalized
  segments (never scheme-relative, query preserved). Files carry a
  content type and a weak ETag with 304 revalidation; GET/HEAD only.
  `appServer({ root, host, bundle })` is the app-serving preset —
  `secureHeaders` opt-out, the bundle at `/bundle.json` with ETag
  revalidation, and an HTML navigation gets the shell with boot state
  injected. `appShell` escapes a hostile title into text and
  neutralizes state that tries to close its `<script>` block.
  `diskHost()` is the Bun-backed default and the package's one
  filesystem seam — everything else stays host-free (#99)

- The server security boundary lands, all over WebCrypto: `sessions()`
  HMAC-signs by default (AES-256-GCM opt-in), decodes `c.session`
  before the handler and writes one cookie after only on change — an
  emptied session expires its cookie and a 5xx commits nothing. A
  missing, blank, or too-short secret is a startup failure, not a
  runtime crash; cookies are `HttpOnly`, `Secure`, `SameSite=Lax` by
  default; a tampered or foreign cookie is a fresh empty session,
  never a throw. `csrf()` is header-only double-submit held to the
  same secret standard (constant-time compare, HMAC-bound cookie, no
  form fallback). `secureHeaders()` ships the modern set with
  `X-XSS-Protection: 0` and opt-in CSP/HSTS; `trustProxy()` reads
  `X-Forwarded-*` only on explicit opt-in and accepts a forwarded host
  only in bare `hostname[:port]` shape; `harden()` gates URL length
  and method on already-parsed values. Every piece is an ordinary
  compose() middleware and the package stays server-only (#98)

- Route input speaks the validate vocabulary: `reading()` parses the
  body once and installs `c.read` over body ∪ query ∪ params (params
  win, own data only — never a prototype member, and a scalar met
  mid-path is a miss, not a value). Absence routes to the miss path
  before any validator runs: a required field that is missing or
  blank is a 400 saying so, a present-but-invalid one is a 400 saying
  THAT, and `!` always outranks a miss default. Unknown validator
  names and ambiguous numeric enumerations reject loudly.
  `withInput(schema, handler)` validates the JSON body through a
  schema before the handler runs — the coerced value is `c.input`,
  failures are structured 400s with `{field, error, message}` issues,
  and a bodyless method is a loud mistake. `openapi(routes, info)`
  derives the deterministic document from the route table: sorted
  paths and methods, identical schemas deduplicated into components
  under their own names, first-registered-wins when constraint
  variants template to one path, and the same table is the same bytes
  in any registration order (#97)

- The server pipeline exists: `compose({ use, before, after, handler })`
  builds the middleware onion — `next()` returns the downstream
  Response for inspection or replacement, a fire-and-forget `next()`
  still resolves to the real response, a `next()` held past the
  response throws loudly, and silent drops or double calls are loud
  500s, never hangs. Before filters guard; after observers run at the
  onion's center on guards and envelopes alike and may replace the
  response; a throw in any stage translates through the hardened error
  envelope; aborted requests exit 499 at stage boundaries; `c.locals`
  is the request-local bag, proven isolated under concurrent requests.
  Core middleware ship alongside: `cors()` (scoped policies always
  `Vary: Origin`; exact preflight detection via
  Access-Control-Request-Method; credentials never ride a wildcard or
  the literal `null` origin) and `logger()` (logs the status actually
  sent, envelopes included, and contains its own faults — a broken
  sink loses a log line, never the response) (#96)

- The server gains its request context: `createContext` wraps one
  web-standard Request into the handler surface — params, query
  (last-wins on both faces, like `parseQuery`), case-insensitive
  headers, and `parseBody` dispatching on content type, total over
  hostile input. Response helpers build JSON/text/HTML/redirect/file
  responses from staged headers (set once, land on every later
  response — 304s, redirects, and error envelopes included; per-call
  headers override without leaking across responses), `cache()`
  stages RFC-integer freshness loudly, and `send()` serves through an
  injected synchronous file host with weak-ETag revalidation — no
  default host exists, and a host without freshness numbers serves
  without a validator rather than minting a shared bogus ETag.
  `errorEnvelope` is the one deterministic error translation (`notice`
  and `issues` user-facing, 4xx messages shown, 5xx and raw throws
  masked), and `respond()` drives any handler result to a Response
  with a guarantee that is total: an error hostile to its own envelope
  still comes back as a bare 500, never a rejection (#95)

- The server stage opens with `@rip-lang/server` and its pure request
  matcher: `createMatcher` routes in registration order, first match
  wins, with `:name` params (percent-decoded, never empty),
  `:name{re}` constraints judging the decoded segment (capturing
  groups — named ones included — reject), and `*rest` catch-alls in
  final position taking at least one non-empty segment. Every
  malformed spelling rejects loudly at registration naming the
  pattern, as do exact method+pattern duplicates; `match()` and
  `parseQuery()` are total functions over arbitrary request strings.
  Decoded captures are data, never path-safe; query parsing is WHATWG
  (duplicate keys keep last, `+` is a space, `__proto__` lands inert).
  The package is server-only by design — browser safety is never
  declared, and the package suite enforces it (#94)

- Applications boot through the browser entry: `bootApp` fetches the
  bundle with ETag revalidation against session storage (a 304 serves
  the cached body; a bodyless revalidation rejects loudly), stands up
  the module graph, compiles the app package and every `_route`/`_app`
  module up front — a module that fails to compile rejects the boot at
  its own path and line — and hands `launch()` a fully compiled
  bundle. The application declares its stash in `_app/stash.rip`
  through its `appStash` export (a stash module without the export
  rejects; the `stash` option still overrides for tests and embedding
  hosts), so render gates prefetch through boot — and the seed clones
  on the way in, cells by reference, so a relaunch starts from the
  declared baseline instead of the last session's writes. The graph
  caches per app fingerprint, honoring the renderer's one-per-page
  render-gate claim, and each reboot syncs it to its own bundle:
  loader invalidation is transitive through importers, modules a
  bundle no longer carries stop resolving, and the packages table
  follows the bundle. A poisoned bundle cache self-heals with one
  unconditional refetch, a fresh body caches only once it parsed, and
  the bundle cache (`bundleStorage`) never collides with the persist
  backend. `debug` compiles every module with an inline source map and
  ships nothing in production boots. The loader now recognizes the
  emitter's runtime delivery imports by their exact pathnames wherever
  the build puts them (the bundled emitter emits `/dist/browser/…`
  paths, not `src/…`), script-tag diagnostics survive Firefox's
  console serialization, and every bundle carries `@rip-lang/app` as
  its boot substrate. Real-browser certification runs under Playwright
  in `packages/browser-tests` — an isolated dependency boundary —
  driving boot, navigation, render gates, ETag reload, debug source
  maps (over CDP), and script-tag scope/diagnostics in Chromium,
  Firefox, and WebKit, wired into CI (#93)

- The browser package graph exists: the emitter records every emitted
  module-specifier span — static imports, re-exports, and
  delivery-injected runtime imports; generated text is never scanned —
  and `createModuleLoader` compiles bundle modules on demand, splices
  resolved specifiers by exact offset, and loads them as real ES
  modules through object URLs, bridging `src/runtime/*` imports to the
  page's one runtime copy. Concurrent imports of a shared dependency
  join one load; true cycles reject with the requesting chain; unknown,
  server-only, traversal, and extensionless specifiers reject naming
  the importer. `assembleBundle` walks recorded spans to collect
  `_pkg/<name>/` modules for packages declaring `rip.browser`, carries
  manifest subpath exports, and rejects server-only imports and
  `:model` schemas at assembly (#92)

- `<script type="text/rip">` loads: data-src bundles, inline text, and
  src fetches concatenate into ONE program compiled in the compiler's
  new script mode and run as one async closure — the page's scripts
  genuinely share a scope, re-spelling assigns instead of colliding,
  and reactive state crosses scripts directly. Module forms reject at
  their own positions (the compiler owns the judgment, so string
  content that merely looks like a module form is never touched). A
  failing script drops with its own label and local line while the
  rest of the page recompiles and runs; duplicates reject loudly
  across URL spellings; a CSP that blocks function construction gets
  one loud unsafe-eval diagnostic while the page's own runtime errors
  report as the page's own (#91)

- The browser entry exists: `src/browser.js` exports the compiler
  surface (`compile`, `compileToJS` — scope delivery only, other modes
  reject by name) plus one copy of every browser-safe runtime as the
  `runtimes` scope namespace, with every delivered name pinned present
  and overlapping re-exports pinned identical. A deterministic bundle
  builds under a pinned Bun into the committed `dist/browser/rip.js`
  (byte-gated in CI, which now pins the toolchain), and structural
  gates parse the real import graph so no server-only module or
  unstubbed builtin can ever reach the browser. stdlib's `abort`/`exit`
  end the process where one exists and throw by name where none does
  (#90)

- Route-aware accessibility completes the App foundation: `ariaCurrent`
  keeps `aria-current` truthful across owned anchors (exact page,
  ancestor true, walker marks cleaned when unearned and at dispose;
  application-managed marks never touched), and `ownsAnchor` is the one
  ownership predicate, resolving document hrefs through the router's
  new `claims(url)` — base-aware, hash-aware, and immune to
  protocol-relative and backslashed spellings even under catch-all
  routes, which the router itself now also refuses to navigate (#89)

- `launch()` is the one application boot path: it assembles the stash
  (seed data merges around live sources at every depth and the result
  stamps the reset baseline), loads the component registry, derives the
  route manifest, and wires router and renderer before installing
  `__ripApp`/`__ripRouter`. A second launch or malformed bundle rejects
  loudly, a start-time failure tears down instead of wedging the
  process, and `destroy()` restores every global. `persistStash`
  projects plain stash keys into Web Storage around live cells, saves
  on a stash-wide write version (deletes included), and `reset()`
  purges the snapshot and stays purged. Hostile `__proto__` keys in
  seeds or snapshots become inert own data (#88)

- `@rip-lang/validate` is certified complete: browser safety is declared
  and test-enforced (`rip.browser`, zero host APIs, an import-free
  vocabulary), the public surface carries exactly one documented `any`,
  every validator and registration path is pinned, and the roadmap
  reflects the finished capability (#87)

- `@rip-lang/app` gains the write-side and timing primitives:
  `createMutation` wraps an async action with reactive
  pending/succeeded/error flags where the newest invocation owns the
  outcome — superseded calls flip nothing, run no callbacks, and
  resolve undefined, and a throw in onSuccess surfaces instead of
  masquerading as a failure. `delay`, `debounce`, `throttle`, and
  `hold` derive timed signals from signal or function sources; timers
  die with their effect, signal sources keep a write-through wrapper,
  and function sources are read-only. Construction costs measure ~0.5µs
  per mutation and ~1µs per timed signal (#86)

- The app renderer integrates with navigation: a staying navigation
  keeps the mounted page's identity and calls `load(params, query)`;
  an unchanged layout chain survives page swaps without re-gating,
  rebuilding whenever a keyed gate retargets; and gate failures route
  to the nearest already-gated ancestor with `onError` — boundary
  chains construct against fully populated gate values, reused chains
  route to the living instance, and failures without a boundary retain
  the previous screen (#85)

- `@rip-lang/app` owns navigation: `createRouter` runs a reactive state
  machine over the route manifest with history, URL, and scroll behind
  an injectable adapter (`browserAdapter()` is the History-API
  implementation), so the whole machine tests under Node. `current`
  bundles route, layouts, params, and query into one reactive
  dependency with identity-stable params/query; fragment-only
  navigation never looks like a route change. History writes land
  before state and callbacks, so onNavigate redirects supersede a
  coherent history, and redirect loops cut loudly at depth ten.
  Unmatched URLs report structured 404s and change nothing (#84)

- `@rip-lang/validate/coercers` bridges the validation vocabulary into
  schema coercion: importing it registers every validator — current and
  later-registered — as a `~:name` coercer, with raw validators
  registering raw. The schema runtime's coercer registration rejects
  duplicate names and async or generator functions loudly, and a
  coerced `false` is now a legitimate value rather than a miss, so a
  boolean vocabulary can say no (#83)

- `@rip-lang/validate` owns the dependency-free validation and
  normalization vocabulary: 37 pure synchronous validators (numbers,
  money-as-integer-cents, lossless decimals, strings, US names and
  addresses, calendar-true dates, times, booleans, identity, network,
  and structured forms) behind a frozen Map registry. Registration
  rejects duplicates, async/generator functions, and invalid names;
  `check` rejects unknown type names; date validity is computed from
  written components before any `Date` exists and normalizes to
  `YYYY-MM-DD`; money requires grouped thousands; the package suite
  runs as its own CI boundary (#82)

- Match reads deliver their runtime: `text =~ /re/`, `text[/re/]`, and
  `text[/re/, n]` structurally trigger delivery of the stdlib's
  `toMatchable` helper their lowerings spell — in both inline and import
  modes — and a program-scope `toMatchable` binding mints an alias the
  lowering spells instead. A compiled match-op program ran only where the
  test harness injected the helper by hand; under real delivery it threw
  ReferenceError (#81)

- Render gates (`member <~ @app.data.source`) now carry RFC-12 roles and
  mappings, bind before component initialization, and reject direct or embedded
  construction. The app renderer prefetches singleton/keyed sources exactly
  once, validates addressed subpaths, constructs layout ancestry transactionally,
  and reports structured failures. Its private construction capability is
  single-owner, and prefetched bindings subscribe to later source writes without
  rereading addressed getters; the pending lane is empty (#78, #79)

- The private dependency-free `@rip-lang/app` substrate now provides reactive
  stash data, singleton and keyed source cells, honest public declarations,
  and an in-memory component registry behind its own package and CI boundary
  (#77)

- The email package now has one public authoring entry, separate substrate
  contracts, transactional SSR global restoration, validated DOM structure and
  curated content boundaries. Tailwind output resolves standalone values,
  follows stylesheet and inline cascade precedence, scopes residual CSS once,
  and isolates closure-backed configurations. URL normalization, font style
  generation, and fallback rendering reject control-character bypasses
  and fail closed on ambiguous scheme prefixes; shared compatibility CSS emits
  once per message. Plain-text projections, empty attributes, Tailwind bytes,
  and Tailwind declarations are deterministic across every public path
  including structured inline-code children
  (#66, #67, #68, #69, #70, #71, #72, #73)

- Email support is complete: full HTML/text rendering, dynamic blocks,
  native table trees, package self-imports, and a typed welcome example
  now run through the public `@rip-lang/ui/email` surface. The final five
  contracts joined the battery and only render-gate contracts remain pending (#65)

- Tailwind email support is isolated behind `packages/ui/tailwind`,
  with exact package-scoped `tailwindcss` and `css-tree` dependencies.
  Supported classes inline, responsive CSS stays in the head, and
  unsupported classes remain intact; three contracts joined the battery
  (#64)

- The typed email catalog adds document, layout, typography, button,
  markdown, code, and font components through a named-only barrel.
  Dynamic blocks serialize before lifecycle disposal, and twenty-four
  component contracts joined the permanent battery (#63)

- Email SSR mounts components through the public lifecycle, serializes
  synchronously, disposes owned effects, and restores host globals in
  `finally`. Nested renders reject loudly, and package type checks now
  preserve real module paths; three render contracts joined the battery
  (#62)

- Email compatibility helpers normalize units and padding, generate
  preview spacing, serialize styles, and emit MSO conditionals. The UI
  package now validates every TypeScript face and declaration under
  strict `tsc`; fourteen contracts joined the permanent battery (#61)

- Email rendering foundation: `packages/ui` now owns a typed synchronous
  DOM, deterministic HTML serialization, and plain-text conversion.
  Twenty-six email contracts moved from the pending lane into the
  permanent battery, with an independent package CI boundary (#60)

- Compiler and runtime correctness: lowerings preserve evaluation,
  control, bindings, and RFC-12 mappings; schema/ORM paths validate
  structure and stable identity; reactive/component lifecycles stay
  coherent; compiler-emitted runtime helpers use minted aliases so
  source bindings cannot capture language sugar (#55)

- Interpolated string keys: `{"#{k}": v}` — the template is a
  computed key (`[\`${k}\`]: v`), surrounding literal text included
  (`{"pre#{k}post": 1}`). The misleading "@-keys" rejection this
  input used to trip is gone (#49)

- Compound object keys: an identifier chain joined by `.` (any
  spacing) or `-` (tight on both sides) directly before `:` is ONE
  string key — `{ data-src: 1 }`, `{ www.amazon.com: 4 }`,
  `{ beta-site.amazon.com: 2 }` — in explicit and implicit objects.
  Spaced subtraction keeps its reading (`{ k: a - b }`), and a
  ternary's `:` never claims (`a ? b.c : d` keeps its member read).
  Vim and VS Code highlight the chain as a key (#48)

- Tagged templates: a string right against a value (`tag"x"`,
  `obj.fn"x"`, `f(1)"x"`) or bridged by `$` (`sh $"cmd #{c}"`) calls
  the tag with the template — `tag\`x\``, raw strings preserved,
  interpolation carried through. A SPACED string keeps its
  implicit-call reading (`tag "x"` → `tag("x")`). All three editor
  grammars highlight the `$` bridge (#47)

- The pending lane reads like the battery it feeds: blank line
  between rows, `'''` heredocs for multi-line sources and expected
  code, single-quoted one-liners — regenerated mechanically and
  round-trip-verified through the runner's own transforms (507/507
  exact) (#46)

- The pending lane (test/battery-pending): 507 language behaviors the
  battery does not cover yet, spelled as battery rows (same four
  verbs) and asserted to STILL FAIL — the suite stays green while
  features are missing and flips red exactly when a change makes a
  pending row pass without moving it into the real battery. Reviving
  a row is cut-and-paste into test/battery/ in the feature's own
  change; the lane dies when the directory empties (#44, #45)

- Editor grammars live here and move with the language: the vim
  plugin (packages/vim — syntax, indent, ftdetect, ftplugin) and the
  highlight.js grammar (packages/highlight — Rip Print consumes it)
  join the VS Code TextMate grammar, and all three now carry word
  arrays (`%w[…]`, every delimiter family) and the assignment
  operators `.=`, `*>`, `?=`. Every syntax addition updates all
  three surfaces in the same change (#43)

- Word arrays: `%w[foo bar baz]` is `["foo", "bar", "baz"]`.
  Delimiters pair (`[] () {} <>`, nesting counted) or repeat
  symmetrically (`%w|a b|`, `%w/x y/`); backslash-space keeps a
  space inside a word; an unclosed literal rejects positioned. The
  scan emits real bracket/string/comma tokens with each word's true
  span, so mapping stays exact (#42)

- `bun run test:rip` — the battery alone: every test/battery/*.rip
  row (the language's syntax contract), sub-second. The inner loop
  for language work; `bun run test` stays the fast full loop and
  `bun run test:all` the canonical suite (#41)

- JavaScript-parity spellings: literal `===`/`!==` normalize to the
  strict COMPARE the two-character spellings already emit (all four
  spellings mean strict equality); `?=` assigns when the target is
  nullish (the `??=` compound's short spelling — `0` and `""` are
  kept); and `new.target` passes through inside constructors (the
  import.meta meta-property precedent) (#40)

- Method assignment and merge assignment: `x .= trim()` re-binds the
  target to a method call on itself (`x = x.trim()`, chained right
  sides included), and `*>obj = {…}` merges the value into the
  target, initializing it when nullish
  (`obj = Object.assign(obj ??= {}, {…})` — a plain-name target
  declares on first use). Both spell the target twice, so an impure
  member target binds its base once on a pre-line; both are
  statements and reject in value position (#39)

- Return guards: `x or return e`, `x and return e`, and
  `x ?? return e` (with or without a value, bare or assigning:
  `y = x or return "no"`) lower as statement rewrites —
  `if (!(y = x)) return "no";` — the one lowering that keeps the
  return's function target. Value-position uses, top-level uses, and
  uses inside expression-lowered constructs all reject positioned
  (#38)

- Await-emitting call chains group correctly: `g!()` and `g!.x`-style
  spellings agree — a call whose callee is the dammit operator sits in
  the unary tier, so `fetch!("u").json!()` emits
  `await (await fetch("u")).json()` instead of binding the accessor
  onto the Promise. A string-LITERAL left operand of `*` is repetition
  (`"-" * 40` emits `"-".repeat(40)`; a dynamic left operand keeps JS
  `*`). A bare word-unary left operand of `**` groups
  (`(typeof x) ** 2` — the unparenthesized form is a JS SyntaxError).
  Every `code` battery row's emitted output must now PARSE as
  JavaScript, so a byte pin can never lock in unrunnable output again
  (#37)

- Declaration output carries the module's edges: imports whose names
  the declarations reference are retained (an unimported name broke
  every consumer with TS2304), `export default` emits as itself
  instead of an export-nothing marker, and re-export lists and star
  re-exports pass through. Unreferenced and side-effect imports drop;
  an untyped name's export specifier drops (no declaration to name).
  A consumer-resolution gate now type-checks a real importing program
  against the generated declarations under tsc (#36)

- AGENTS.md — the operating rules for any agent (AI or human) working
  in this repository — now lives at the top level. Eight standing
  rules (reject loudly; lowerings preserve source shape; no hand-
  edits to generated files; timeless code; tests as contract;
  no silent output changes; claims verified not asserted; honest
  PR-only commits) plus the full lowering doctrine, runtime doctrine,
  mapping never-list, style vocabulary, test-authoring sharp edges,
  and command reference (#35)

- Runtime validation is stateless and structural: a `/g` or `/y`
  schema constraint resets its cursor before every test (identical
  inputs validate identically); an object schema rejects a primitive,
  `null`, or array input with a structured issue instead of spreading
  it into an empty instance; a written calendar date must exist —
  `2024-02-30` fails validation instead of silently becoming March 1
  (leap years honored, timezone-independent); and replacing a
  component's style OBJECT clears the declarations the new value
  omits, so stale styles never linger (#34)

- Reject loudly where control flow and writes have no target: `return`
  and `yield` outside a function, `break`/`continue` outside a loop,
  and `return`/`break`/`continue` inside an expression-lowered
  construct (the IIFE would capture them) all reject positioned — a
  function-TAIL if/try/switch keeps its `return`, which tunnels
  through the lowering to the enclosing function. Writes and updates
  to a computed (`~=`) binding reject at compile instead of throwing
  at the runtime's read-only container; an optional chain rejects as
  an update target (`obj?.x++` has no JavaScript reference); a
  non-string `compile()` source fails with one stable identifying
  error; the human diagnostic caret respects display cells (tabs and
  astral glyphs); and the project-config comment states present
  invariants (#33)

- Component value members initialize in SOURCE ORDER (they were
  grouped by kind, so a plain member written after a state ran first
  and could not read it); offers register after the values and
  effects still start last — a reaction never fires against a
  half-built instance. The initialization contract is one sentence:
  members initialize as written, effects start after construction (#31)

- Preserve the source program's shape through seven lowerings (the
  third cross-vendor review's evaluation/scoping cluster): a ternary
  used as another ternary's condition keeps its parens; an optional-
  chain assignment's impure receiver binds once, so the guard and the
  write see the same object; indexed, stepped, object, own, and
  range-bounded loops evaluate their source exactly once (pure
  sources keep byte-identical headers); the complex-pick parameter
  and the catch scaffold parameter mint against user bindings (`_`
  and outer `error` reads now resolve to the user's own); a value-try
  catch binding shadows same-named reactives like the statement form;
  and a source-escaped `\${` in an interpolated string stays literal
  instead of turning into a live interpolation (#30)

- Quiet the implicit-any family's missing members in the editor:
  importing a plain .js module (no declaration file, TS7016) is legal,
  idiomatic Rip and no longer squiggles — likewise `new` on an untyped
  target (7009), indexing without a signature (7017), and the indirect
  self-reference return (7024). Annotated code never fires the family;
  real error classes are untouched and pinned so (#29)

- Fix five findings from the second cross-vendor review: `throw` in
  any expression position lowers to a throwing IIFE (it previously
  emitted `throw(...)` — a call of the keyword, invalid JavaScript
  that seven stale pins had locked in); a nested block loop in value
  position accumulates like the parenthesized comprehension (it
  silently produced `[]`), staying a statement only when a `return`
  must cross out; `//=` and `%%=` evaluate a member/index base exactly
  once through an IIFE lowering; an unescaped `#{` in a slash regex
  rejects loudly naming the heregex form (it silently matched literal
  characters); and a second `export default` rejects at emit instead
  of shipping a module that cannot instantiate (#28)

- Fix five front-end findings from the cross-vendor cold review:
  signed numeric literal casts claim (`x = y as -1` erases; `+1`
  rejects naming TypeScript's '-'-only rule; a committed cast that
  claims no type rejects instead of silently reading `as` as a call);
  ternaries pair their colons per bracket depth, so a parenthesized
  nested ternary and an object literal in a ternary branch both work
  (both previously misparsed); the `::` member lookahead accepts the
  full identifier alphabet (`String::señal`); offsetAt clamps a CRLF
  line at the `\r`; and the editor's cursor mapper refuses the
  vacuous zero-byte cover match the insertion mapper already
  refused (#27)

- Fix five silent-miscompile classes found by the cross-vendor cold
  review: a value-position subjectless switch now ORs every condition
  in a multi-test `when` (only the first decided before); membership
  (`in`) with a constructed container dispatches through a helper call
  so the container evaluates exactly once (the inline form re-read
  it); a catch-pattern target named `error` now escapes (the lowering
  hard-coded the parameter name it collided with); comprehension and
  loop accumulators dodge user identifiers (`result = 10` no longer
  captures into its own accumulator); and module specifiers escape
  embedded quotes and backslashes (an apostrophe emitted invalid JS).
  Plain-name containers and collision-free programs keep byte-identical
  output; two corpus artifacts regenerate for the membership helper (#26)

- Complete prototype access with the soak form: a tight `a?::b` reads
  as `a?.prototype.b` (the existence token becomes the optional-member
  link), soak writes lower through the optional-assign guard, and the
  annotated soak write rejects shaped — an augmentation declares the
  member EXISTS, which a conditional write cannot carry (#25)

- Index the mapping offset queries: atGenerated/atSource answer
  through a centered interval tree (O(log n + k) per stab) instead of
  filtering and sorting every row (O(n)), with results byte-identical
  to the full scan, order included. The editor maps every diagnostic,
  hover, and navigation position through these queries, so per-publish
  mapping cost on large files drops ~250x (300 queries over a
  48,000-row table: 19.1 ms to 0.08 ms; the index builds lazily per
  side in ~5 ms, once per compile). Pinned by corpus-wide equivalence,
  a count-keyed staleness test, and a near-linear ops-scaling gate (#24)

- Restore stripped test coverage: eight test files defined fixtures
  whose consuming blocks were lost to over-eager de-witnessing — six
  ran zero tests. Every self-contained block is converted and kept;
  genuine sibling-compiler comparison arms are dropped; comments and
  titles state present-tense invariants. Recovered 723 tests
  (~967,000 assertions): types 4→299, sourcemap 0→137, mapping 0→126,
  schema 0→66, voidmarker 0→37, async 0→26, enum 1→23, pick 0→14.
  The corpus-invariant sweeps now run over the full current corpus (#23)

- Fix comment and test-title typos left by earlier scrubbing: doubled
  articles, unfilled placeholder phrases reworded to name the actual
  rule or mechanism, empty citation parentheses, dangling section
  references, and mangled comparison titles restated as the invariant
  they pin. Comments and test titles only — no behavior changes (#22)

- Enable prototype access: `X::m` reads and writes `X.prototype.m`
  (`String::capitalize = -> …`), and an ANNOTATED write
  (`String::capitalize: () => string = -> …`) manifests its annotation
  as an interface augmentation in the TS face and `.d.ts` — `declare
  global` for outside heads (generic globals repeat their parameter
  lists, so the annotation can name `T`), a same-module interface for
  a declared class — so the write, every call site, and hover all
  resolve the member with zero editor noise. Every shape that cannot
  deliver rejects loudly at its own position: a doubled colon outside
  the operator (including inside annotation text), an annotated write
  below the module top level, and an annotated write on a module
  binding that is not a class declaration. Augmentation bytes carry
  the annotation's mapping role, so TS diagnostics on them land on the
  author's annotation. The editor's generated tsconfig now also
  includes workspace `.d.ts` files, so hand-written ambient
  augmentations govern in the editor exactly as they do under batch
  tsc, and the type-audit fixtures pin the whole story (hover
  resolution included). Restores the lost consuming test sections of
  test/toolchain/dts.test.js (#21)

- Split the type-audit into two audits and add the tsgo twin oracle:
  the default run is the five-dimension grid (fast, streams rows live);
  `--hover`/`--all` adds the Hover Audit, which hovers every top-level
  declaration and judges each answer against TWO references — the
  hand-written twin hovered through a raw tsgo LSP (the actual
  TypeScript answer, after quote/keyword/union-order normalization)
  and the pinned hovers.json snapshot (the regression net over every
  probe, twin or no twin) (#20)

- Add the generator's own test suite (src/grammar/test: the annotation
  validator and the semantic side table, colocated with the tool) and
  the exactness differential (test/mapping/exactness.test.js: the
  incremental mapping-exactness algorithm proven equal to its literal
  definition over the corpus and adversarial chain shapes) (#19)


- Add the type-audit gauge (test/type-audit): twelve real-world typed
  fixtures with .ts/.tsx twins, a six-dimension audit runner (compiles,
  directives kept, editor verdict, runtime parity, twin validity, and
  pinned hover snapshots), the any-hover gauge metric, and the
  `bun run type-audit` script (#17)

- Give battery files real imports: the four verbs (test, code, fail,
  type) live in test/support/testing.js and every battery file imports
  them — the editor resolves the vocabulary, and a battery file run
  directly (bun test/battery/assignment.rip) executes standalone (#16)

- Wire `bun run ext` to the shared extension installer, and carry the
  icon field into the staged vsix manifest so editors show the
  extension icon (#14)

- Set the VS Code extension version to 4.0.0 (#13)

- Enforce the test boundary: root test runs mechanically exclude
  packages/**, whose suites run from their own packages (#12)

- Add the VS Code extension: syntax highlighting, hover, diagnostics,
  completions, go-to-definition, references, rename, signature help,
  semantic tokens, code actions, outline, inlay hints, and document
  links through the compiler's TS face and the TypeScript 7 LSP server;
  its suite runs as its own CI step and the dependency budget is
  enforced (#11)

- Add the UI and face test suites: components and the render DSL,
  reactive declarations, effects, readonly, the reactive/component/ORM
  runtime batteries, the TS-face strip gate with real-tsc validation,
  and the recording DOM and adapter test doubles (#10)

- Group the test suite by layer: lang/, mapping/, schema/, and
  toolchain/ directories under test/, with corpus/, battery/, and
  support/ unchanged and the battery runner beside its rows (#9)

- Run the extended tier in CI: TypeScript installs as a pinned external
  tool and `bun run test:all` arms the extended and tsc-gated checks —
  the meta-gate that requires this in CI now passes by construction (#8)

- Add the language test suite: the battery (25 files of idiom rows with
  their own runner), mapping and source-map conformance, declaration and
  schema-type checks, migration machinery, types, async, pick, void
  markers, tiers, trivia, dependency budget, TS-face fuzzing, and the
  parser-currency guard (#7)

- Add the compiler surface and corpus: the compile() entry point, project
  configuration, the Bun .rip loader, the run harness, the rip CLI with
  explain and schema evolution, the corpus snapshot layer with committed
  expected artifacts, and CI gates for parser regeneration and corpus
  drift (#6)

- Add the emitter, type faces, and feature runtimes: the full JS/TS
  two-face emitter with exact mapping rows, declaration emission, the
  schema and component type stories, and the inline-delivered reactive,
  component, schema, ORM, and stdlib runtimes (#5)

- Add the grammar and generated parser: the SLR(1) generator (solar), the
  grammar with semantic annotations and pattern labels, and the generated
  parser with node/role store population at reduce time (#4)

- Add the lexer and its rewrite passes: the offset-native tokenizer with
  trivia channel and literal-prefix indentation, the type-annotation
  collapse pass, the schema and render sub-parsers, the DOM vocabulary
  tables, and continuous integration (#3)
- Add the source/mapping foundation: operation counters, SourceFile with
  offset↔line/col conversion, node/role/mapping store query layers,
  CodeBuilder with exact-span mark protocol, Source Map V3 serialization,
  and stack-frame remapping (#2)
- Add project scaffolding: package manifest, ignore rules, MIT license, and
  this changelog (#1)
