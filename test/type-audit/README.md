# The type-audit gauge

A repeatable **progress gauge** (not a pass/fail gate) for the typed
developer experience: the compiler's TS face plus the tsgo-brokered
editor, measured over real-world typed fixtures. Nothing here is part
of `bun test` — run it when you want the scoreboard.

## Contents

| File          | What it is                                                     |
| ------------- | -------------------------------------------------------------- |
| `fixtures/`   | Typed programs 01–12, each `.rip` with a `.ts`/`.tsx` twin.    |
| `runner.js`   | Both audits — the dimension grid and the hover audit.          |
| `hovers.json` | The pinned hover snapshot every hover run compares against.    |

## Run it

From the repository root:

```sh
bun run type-audit                  # the Type Audit (five dimensions) — fast, the default
bun run type-audit --hover          # the Hover Audit only (drives LSP servers; slower)
bun run type-audit --all            # both audits
bun run type-audit --v              # + list the expected hover divergences in full
bun run type-audit --update-hovers  # accept current hover text as the pinned snapshot
```

(`bun run type-audit` is `bun test/type-audit/runner.js` — the direct path
works too.)

First-time setup, once per clone:

```sh
cd test/type-audit && bun install   # the fixtures' dependency sandbox (react, zod, zustand, dayjs)
cd packages/vscode && bun install   # brings tsgo via the pinned typescript dependency
```

The sandbox deps live in THIS directory's package.json — never the
repository root's.

## The Type Audit — five dimensions per fixture

| Dim        | Measures                                                    | Fail means            |
| ---------- | ----------------------------------------------------------- | --------------------- |
| compiles   | `rip --ts` produces a face                                  | compiler-coverage gap |
| directives | the face keeps every `# @ts-expect-error`                   | face-emission bug     |
| verdict    | the editor server publishes zero Error-severity diagnostics | type-face divergence  |
| runtime    | `rip x.rip` stdout equals `bun x.ts` stdout                 | behavioral divergence |
| twin       | the `.ts`/`.tsx` twin type-checks under the strict tsconfig | reference twin invalid|

The fixtures self-check: a `# @ts-expect-error` marks a line that MUST
error. If the face and tsgo satisfy every marker and add none, the
editor publishes nothing — that is the verdict passing.

## The Hover Audit — twin oracle + pinned snapshot

Every top-level declaration is hovered through the editor server, and
each answer is judged twice:

**Twin oracle (correctness).** Where the hand-written `.ts`/`.tsx` twin
declares the same symbol, hovering the twin through a raw tsgo LSP gives
the *actual* TypeScript answer — the editor's hover should match it.
Cosmetic differences are normalized away (string-quote style, binding
keyword, union-member order); what remains is a **gap**: the editor
showing a different type than TypeScript itself — the one actionable
bucket. Rip-native constructs (component / schema / reactive) are
expected divergences: the twin approximates them with a different
system (React / zod), so it is not an oracle there.

**Snapshot (regression).** Every probe is pinned in `hovers.json`,
twin or no twin. This exists for the **write-only-`any`** class: a
binding whose face compiles, emits no diagnostic, and runs identically —
but hovers `any` where a real type belongs. Error-based dimensions
cannot see it; pinned hover text can. Accepting new hover bytes is an
explicit act (`--update-hovers`, regenerated in the same commit as the
change that moved them).

The report's closing **gauge** scores probes answering a real type
rather than `any` — full marks is the goal. An independent invariant
also runs oracle-free: an initialized binding (`name = expr`) must
never hover `any`.
