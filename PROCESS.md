# PROCESS.md — How Work Becomes Trusted Code

`AGENTS.md` defines the repository's mandatory invariants. This document
defines the quality process that changes pass through before merge.

The central rule is simple: code earns trust by surviving deterministic
gates and independent attempts to falsify its claims.

## 1. Principles

1. **Deterministic gates first.** Tests, parser regeneration, corpus
   snapshots, strip identity, type validity, and scaling/fuzz gates are
   the primary evidence. Model or human review supplements them.
2. **Exactly one writer.** One agent or person owns mutations in a
   checkout. Reviewers are read-only. Competing implementations use
   isolated worktrees.
3. **Independent review matters.** A substantial review includes both:
   - an information-independent cold read of the diff or specification;
   - a tool-wielding investigation that can run probes and audit
     consumers.
   A model that coauthored an artifact does not review it as a fresh
   reviewer.
4. **Claims are hypotheses.** Reproduce or refute every actionable
   finding before changing code.
5. **Findings become pins.** Every confirmed defect gains a permanent
   regression test asserting the correct behavior.
6. **Report failures honestly.** A failed, skipped, or partial gate is
   reported as such.

## 2. Roles

- **Writer:** plans, implements, verifies findings, reconciles reviews,
  and keeps one coherent model of the change.
- **Cold reviewer:** judges a self-contained diff/specification without
  repository commentary anchoring the result.
- **Investigator:** reads the repository and runs deterministic probes
  designed to refute the change.
- **Owner:** resolves product decisions, approves campaign rebase
  merges, and decides whether a real finding belongs in the current
  scope.

Vendor diversity is useful because different model families catch
different defect classes. Evidence, not voting, decides dispositions.

## 3. Work tiers

- **Routine:** documentation, mechanical cleanup, or a small obvious
  fix. Writer plus focused/fast gates.
- **Feature:** a coherent feature or defect change with new pins.
  Dual review plus the canonical suite and relevant artifact gates.
- **Release:** a campaign or release-sized body of work. Feature gates
  plus extended validity, fuzz/scaling, parser/corpus certification,
  and an additional independent review where useful.

The presence of a new permanent regression pin normally makes a change
feature-tier.

## 4. Phase playbook

### Plan

State the behavior, ownership seam, test matrix, decisions, and
acceptance gates. Open product decisions are resolved before code
depends on them.

### Implement

Use one writer. Reproduce the defect, add a correct-behavior pin, then
fix the owning abstraction. Generated-output changes regenerate and
enumerate their snapshots in the same change.

### Review

Prepare a neutral reviewer pack:

- the complete diff;
- a short statement of the problem and fix thesis;
- the repository doctrines the change must preserve;
- relevant commands and fixtures;
- no conclusion telling the reviewer that the change is correct.

Run two reviews in parallel where practical:

1. **Cold review:** inspect for missed consumers, invariant holes,
   diagnostics quality, under-pinned behavior, and accidental scope.
2. **Investigation:** run real compiles/tests, audit every consumer of
   touched shapes, inspect corpus/parser drift, and probe compositions
   absent from the tests.

### Reconcile

The writer verifies every finding and records one disposition:

- **ADOPTED:** reproduced, fixed, and pinned;
- **REFUTED:** a named probe disproved it;
- **DECLINED:** real proposal rejected for a stated contract reason;
- **RECORDED:** real but explicitly assigned to named future work.

Adopted changes land in the PR. Dispositions live in the PR discussion;
tests preserve confirmed findings permanently.

## 5. Review priorities

Review in this order:

1. wrong output, crashes, or silent invariant breaches;
2. evaluation-count/order, control-target, or binding-capture defects;
3. mapping/store protocol violations;
4. malformed input accepted instead of rejected;
5. validation, persistence, or lifecycle paths that skip part of their
   contract;
6. under-pinned load-bearing behavior;
7. diagnostics and editor translation correctness;
8. duplicated ownership logic and algorithmic hazards;
9. comment/documentation fidelity.

Legal programs that are rejected are findings too; strictness is not a
license to over-reject.

## 6. Finding format

Every finding contains:

- **Severity:** HIGH, MEDIUM, LOW, or NIT.
- **Location:** file and symbol/line.
- **Claim:** one falsifiable sentence.
- **Failure scenario:** concrete input/state and wrong outcome.
- **Suggested probe:** exact command or test that confirms or refutes
  the claim.

Reports order findings by severity and end with a short list of surfaces
checked and found sound.

## 7. Merge mechanics

- Work happens on branches and through PRs.
- Routine and feature PRs squash-merge by default.
- A coherent campaign whose commits are complete, honestly named, and
  useful review provenance may rebase-merge with owner approval.
- Campaign branches rebase onto current `main`; they never merge `main`
  into the branch. `main` remains linear.
- Commits and PRs carry no AI attribution.
- `CHANGELOG.md` moves with the behavior it describes.
- CI conclusions are observed explicitly before merge; a running check
  is not success.
- Reviewer transcripts are disposable. PR dispositions, commits, and
  regression pins are the durable record.

## 8. Completion

A completion claim names the gates actually run. Compiler/runtime
feature work requires `bun run test:all`; compiler-output work also
requires parser and corpus freshness with every changed artifact
explained. Editor changes additionally require the extension suite.
