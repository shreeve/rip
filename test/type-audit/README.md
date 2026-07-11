# type-audit — the typed-editor gauge

A repeatable **progress gauge** (not a pass/fail gate) for the typed
developer experience: the compiler's TS face plus the tsgo-brokered
editor, measured over real-world typed fixtures. Nothing here is part
of `bun test` — run it when you want the scoreboard.

## Contents

| File          | What it is                                                     |
| ------------- | -------------------------------------------------------------- |
| `fixtures/`   | Typed programs 01–12, each `.rip` with a `.ts`/`.tsx` twin.    |
| `runner.js`   | The whole audit — six dimensions, one report.                  |
| `hovers.json` | The pinned hover snapshot every run compares against.          |

## Run it

```sh
bun test/type-audit/runner.js                  # the full report
bun test/type-audit/runner.js --v              # + per-diagnostic detail
bun test/type-audit/runner.js --update-hovers  # accept current hovers as the snapshot
```

First-time setup: `bun install` here (the fixtures' own dependency
sandbox — react, zod, zustand, dayjs live in THIS directory's
package.json, never the repository root's) and in `packages/vscode`
(tsgo arrives with its pinned `typescript`).

## The six dimensions

| Dim        | Measures                                                        | Fail means            |
| ---------- | --------------------------------------------------------------- | --------------------- |
| compiles   | `rip --ts` produces a face                                      | compiler-coverage gap |
| directives | the face keeps every `# @ts-expect-error`                       | face-emission bug     |
| verdict    | the editor server publishes zero Error-severity diagnostics     | type-face divergence  |
| runtime    | `rip x.rip` stdout equals `bun x.ts` stdout                     | behavioral divergence |
| twin       | the `.ts`/`.tsx` twin type-checks under the strict tsconfig     | reference twin invalid|
| hovers     | hover text at every top-level declaration matches `hovers.json` | hover regression      |

The hovers dimension exists for the **write-only-`any`** class: a
binding whose face compiles, emits no diagnostic, and runs identically —
but hovers `any` where a real type belongs. Error-based dimensions
cannot see it; pinned hover text can. Accepting new hover bytes is an
explicit act (`--update-hovers`, regenerated in the same commit as the
change that moved them). The report's closing **gauge** counts probes
answering `any` — the number to drive down (and keep at zero).

The fixtures self-check: a `# @ts-expect-error` marks a line that MUST
error. If the face and tsgo satisfy every marker and add none, the
editor publishes nothing — that is the verdict passing.
