---
name: type-public-api
argument-hint: "[package]"
description: Type a Rip package's public API until `rip check --public` reports 100%, using the minimum annotations. Use when annotating or typing a package's exports, when `rip check --public` reports untyped positions, or when asked to "type" or "annotate" a package under packages/.
---

# Type a package's public API

`rip check --public <pkg>` reports the type a CONSUMER resolves for every published export, and the path to the first `any` inside it. This takes a package to 100% with the fewest annotations that get it there.

## Scope

The public surface, nothing else. Do not annotate internals to make them checkable — that task is unbounded and is not this one. `--public` is the arbiter throughout, and step 5 removes anything the report turns out not to need.

Know what the audit cannot do. It asks only whether a position carries a type that says nothing, never whether the type is TRUE, so 100% is not proof of correctness. And because internals stay unannotated, a public value entering one becomes `any` a call later, where nothing can contradict what you declared. Step 3 is the whole defense against both.

## 1 — Reconcile the exported surface

Every export is annotation work, so shrink the surface before typing it.

Most packages pin theirs in a flat `test.rip`, under a "Package surface" section asserting `Object.keys(mod).sort()` against the published names. Compare that against the export list `--public` prints: a disagreement is a leak (un-export it) or a stale pin (update it). Settle it now.

- The pin reads runtime values, so type exports never appear in it. Judge those in the `--public` listing; the default is not to export them.
- Not every package has the assertion. Packages with a `test/` tree instead of a flat `test.rip` have no surface section at all, and a few have the section without an assertion under it. Either way, write the assertion first, or proceed knowing this step has no mechanical basis for that package.

Never decide minimality by who imports a name. A package may be consumed through the REPL, a CLI, or apps outside this repo, so in-repo import counts prove nothing unless every consumer is visible.

## 2 — Get the work list

```
rip check --public <pkg>
```

Each leaking export lists its positions and the path to each. Read a path as the walk order: a call's parameter, a member, an array element, a callback's own parameter. A position is reported when it carries `any` or `Function`, which are unchecked wherever they sit, or when nothing was written there at all. A width that is WRITTEN is a claim, and the audit takes it: `unknown`, `object` and `{}` stop a consumer until they narrow, so a deliberate one is a finished answer rather than a position to fix.

## 3 — Derive each type from a named consuming line

The step that makes the result repeatable, and the only one that takes judgment. For every position the report names, find the line that CONSUMES the value and derive the type from what that line does with it. You should be able to cite the line.

- A value handed to a constructor or stdlib call takes that signature's parameter type. A package wrapping a familiar API does not necessarily accept everything that API accepts.
- A value that only reaches a stringifying or serializing call accepts anything. Say so rather than inventing a narrower union the code does not enforce.
- A value discriminated by `typeof` or identity branches is exactly the union those branches test, and nothing more.
- A consuming line that guards with `??` or a null check is telling you the type admits `undefined` or `null`. Read those carefully: gradual mode has strictNullChecks off, so a type that wrongly forbids either still reports 100%.

Deriving from what an API ought to accept is how a type ends up wrong and confident. Over-wide licenses a call that crashes; over-narrow rejects code that works. Read the line.

## 4 — Write the types

**Export nothing a consumer will not name.** Types stay internal by default — an object literal gets contextual typing and never needs the name. Exporting one makes its shape a breaking-change surface.

**An alias needs two or more callers.** Otherwise inline it.

**No comments** on the types or the annotations. A trap worth warning about belongs somewhere that fails when violated, not in prose that cannot.

## 5 — Minimality: remove each annotation and re-run

Take out each annotation in turn and re-run BOTH checks. Keep the ones whose removal degrades the report, and the ones the report does not need but `rip check` does — an annotation can be invisible to the audit and still be what makes the package compile.

Do this over every annotated position — lambda parameters and return types, not just `def` signatures. Reading cannot find these: a single return-type annotation can propagate backward into the binding a composed value is built from, typing the whole thing and making several parameter annotations redundant. When two forms both reach 100%, take the one with fewer annotations; a return annotation with bare parameters usually wins.

Never run the full gate while swapping files — copying a source file over mid-run corrupts every lane that imports it.

## 6 — Verify

```
rip check --public <pkg>     # 100%, exit 0
rip check <pkg>              # no type errors, test file included
```

Annotating a signature breaks any test that deliberately passes a wrong value to prove the runtime rejects it. Mark that line `# @ts-expect-error`, which asserts the error is there and fails if the signature ever stops forbidding it; `as any` would go quiet instead, and quiet is what those tests exist to prevent.

Annotations are erased, so a pure annotation pass emits the same JavaScript and cannot break a runtime test. Confirm the pass WAS pure — a fix that rides along is invisible to both checks above and to a green suite:

```
diff <(git show HEAD:<pkg>/<entry>.rip | rip -c) <(rip -c <pkg>/<entry>.rip)
```

Identical output means the two checks are the whole verification. A difference is a behavior change wearing an annotation pass, and belongs in its own commit ahead of this one. Run the package's own suite when step 1 changed what it exports, since un-exporting a name does change runtime. Run the full gate (`bun run test:all`) when the package is part of the stdlib, since annotations can still move a type-level pin elsewhere in the repo.
