# TEST DIET — Make Safety Enable Change

This is the working plan for making Rip's tests faster to use, cheaper to
maintain, and more valuable when they fail. It is not a permanent architecture
document and does not change a gate merely by proposing one. Each accepted
policy moves into `AGENTS.md`, the owning package, or CI; this file disappears
when the campaign is complete.

## Mission

Tests and static checks exist to make changes safer. They fail their purpose
when ordinary development requires certifying the entire repository, when a
failure does not identify its owner, or when implementation-shaped assertions
make harmless refactoring expensive.

The target is not fewer tests by itself. The target is:

- fast, focused feedback while code is moving;
- strong contracts at public and cross-process boundaries;
- one clear owner for every failure;
- deterministic certification of a frozen merge candidate;
- freedom to leave an intermediate development state incomplete;
- no duplicated proof where one layer already establishes the behavior.

Test count is an inventory number, never a quality score.

## Non-negotiable Safety

The diet does not erase evidence. Keep tests that protect:

- a reproduced defect that could silently miscompile or corrupt state;
- grammar, emission, source mapping, and generated-byte contracts;
- public package APIs and serialized protocols;
- security and trust boundaries;
- transactional behavior, persistence, and recovery;
- one representative real-browser path for browser-owned behavior;
- one representative real-process path for process-owned behavior.

A red test is not weakened merely to make a branch green. First determine
whether it reports a product defect, a harness defect, an environment defect,
or an obsolete contract. Changing an obsolete contract is legitimate, but the
decision must name the contract being replaced.

## Three Working Loops

### 1. Edit loop — seconds

Run the smallest test that can disprove the change:

- the exact regression file;
- `bun run test:rip` for language syntax;
- `bun run test` in the affected package;
- a named Playwright project or spec for browser work.

An intermediate worktree is allowed to be incomplete. It does not need to be a
release candidate after every edit.

### 2. Milestone loop — package boundaries

Run after one coherent layer is working:

- the complete owning package suite;
- direct consumers whose public contract changed;
- artifact freshness for generated output touched by the milestone.

Server work reaches the Server suite before it reaches Rip App. Rip App work
reaches the App suite before it reaches real-browser certification. A large
feature may cross both layers, but each layer earns a stable checkpoint first.

### 3. Landing loop — one frozen candidate

Certification begins only after implementation and review stop changing the
tree:

1. finish implementation with focused tests;
2. run package milestone suites;
3. freeze and inspect the complete diff;
4. complete independent and cold review;
5. apply review corrections and freeze again;
6. run the canonical repository and browser gates once;
7. push that exact commit and let CI certify it;
8. merge without adding cleanup work.

Any code change after step 6 creates a new candidate. Documentation that claims
exact verification is written from the final results, not before them.

## Value Test for Every Test

Every test must answer four questions:

1. What externally meaningful failure does it detect?
2. Which layer owns that failure?
3. What other test would catch it if this test disappeared?
4. What does it cost in runtime, maintenance, nondeterminism, and setup?

Classify each test during the audit:

| Class | Action |
| --- | --- |
| Regression for a reproduced defect | Keep; make the failure name the defect boundary |
| Public or protocol contract | Keep at the owning boundary |
| Representative integration path | Keep the smallest end-to-end proof |
| Repeated permutations of one rule | Collapse into a table or generated cases |
| Duplicate proof at multiple layers | Keep the cheapest authoritative proof; retain one boundary integration case |
| Private implementation shape | Rewrite around behavior or delete |
| Timing, sleep, or retry dependent | Replace with an observable readiness/event seam |
| Environment/tool availability | Move to preflight; do not masquerade as product behavior |
| Type assertion duplicating runtime proof | Keep only if it catches a distinct consumer-facing failure |
| Snapshot with unexplained surface area | Split, narrow, or replace with an intentional assertion |

Deletion requires a short, concrete rationale in the change that removes the
test. No archive of deleted tests is kept; git retains the record.

## Static-Typing Diet

Static typing has the highest leverage at boundaries and the highest friction
when it models every temporary implementation detail.

Prefer static contracts for:

- exported package surfaces;
- compiler and tool result shapes;
- network, disk, and worker messages;
- schemas shared with consumers;
- generated declarations whose bytes are a product artifact.

Do not require static typing merely to restate behavior already proved by the
runtime owner. Avoid compile-only fixture matrices that differ only in syntax
and provide the same diagnostic. One consumer-style type test is usually more
valuable than dozens of internal annotation tests.

Runtime validation remains authoritative at untrusted boundaries. Static types
do not replace it, and duplicate runtime/type suites must identify the distinct
failure each side catches.

## Gate Design

The repository needs distinct commands and CI intent rather than one universal
definition of "test."

### Development gates

- Fast by default.
- Selectable by package, test file, and named subsystem.
- Missing optional tools are reported clearly.
- No browser installation or live multi-process harness unless selected.

### Merge gates

- Operate on a frozen candidate.
- Cover repository-wide compiler invariants and affected package boundaries.
- Include deterministic browser smoke for browser-owned changes.
- Include expensive full-stack certification only when its owned boundary is
  affected or when explicitly requested for a release candidate.
- Never report a reduced suite as the complete suite.

### CI tiers

Design the workflow around intent:

- Draft/work-in-progress: fast compiler loop plus affected package lanes.
- Ready pull request: canonical merge gates.
- Scheduled or release certification: exhaustive permutations, scaling,
  fuzzing, multi-browser expansion, and expensive real-stack exemplars.

Path selection must include declared dependency edges. A package-only change
cannot skip a consumer whose public input changed. When ownership is uncertain,
run the broader gate.

## Harness Rules

An integration harness is product-quality infrastructure with a smaller job:

- readiness acknowledges one completed startup state;
- health checks do not mutate or rediscover startup;
- mutable worker replacement has an explicit current-generation signal;
- a Unix socket path existing is not proof that a process still accepts it;
- tests wait on observable events, not elapsed time;
- retries gather evidence but do not convert nondeterminism into correctness;
- failures retain console, network, process, and page context needed to assign
  ownership;
- environment inability to bind, launch, or resolve is reported separately
  from an application assertion.

A full-stack exemplar should prove a small number of cross-boundary promises.
Feature permutations belong in the faster layer that owns them.

## Audit Procedure

Work one lane at a time. Do not perform a repository-wide mechanical purge.

1. Record the lane's wall time, setup time, count, skips, and flaky history.
2. Group tests by the behavior they claim to prove.
3. Identify the authoritative owner for each behavior.
4. Mark duplicated, implementation-shaped, and environment-shaped tests.
5. Consolidate or remove one group in a reviewable change.
6. Demonstrate that the retained tests still fail when the protected behavior
   is deliberately broken.
7. Measure the lane again.
8. Run the next broader gate only at the milestone boundary.

Use mutation probes selectively: temporarily introduce the named defect, prove
the retained test catches it, then remove the probe. A test that cannot be
shown to detect its claimed failure needs redesign.

## Initial Audit Order

1. `packages/browser-tests`: separate browser-runtime smoke from the live Cart
   Server/Manager exemplar; make harness failures diagnostic and deterministic.
2. `packages/server`: separate pure publication/registration contracts from
   live Janus and process lifecycle certification.
3. `packages/app`: consolidate repeated Workspace/apply scenarios around the
   transactional invariants they share.
4. Root compiler suite: identify repeated syntax/type permutations already
   covered by battery, corpus, mapping, or generated-byte gates.
5. `packages/vscode`: separate fast protocol/unit behavior from tsgo process
   integration and editor-wide certification.
6. Remaining packages: remove duplicate type/runtime proof and standardize
   package-local test entry points.

## Measurements

Track outcomes that reflect developer freedom and defect detection:

- median edit-loop feedback time;
- slowest package milestone time;
- frozen-candidate certification time;
- setup time versus assertion time;
- flaky or unreproduced failures per 100 runs;
- failures that identify the owning layer without log archaeology;
- tests consolidated or removed with preserved mutation coverage;
- number of full-suite reruns caused by changes made after certification began.

Do not set a target test count. A smaller suite can be weak; a larger suite can
be redundant. The useful target is the least maintenance and runtime that
still catches the named failures.

## Completion

The campaign is complete when:

- edit, milestone, and landing commands are explicit and documented;
- CI distinguishes pull-request feedback from exhaustive certification;
- every expensive lane has a named owner and reason to run;
- the browser and process harnesses fail diagnostically and deterministically;
- package contributors can work locally without certifying unrelated systems;
- the final merge gate remains strong enough to protect Rip's public contracts.

Move durable policy into `AGENTS.md` and the owning commands as it is ratified.
Delete this working file when no open diet work remains.
