# Package Upgrade: rip-lang (v3) → rip (v4)

## Task

Bring the traditional Rip packages from **rip-lang** (Rip v3) into **rip** (Rip v4).

Rip v3 had a cobbled-together types/IDE stack that was brittle. Rip v4 rearchitected that around TypeScript 7 and a much more efficient source↔editor mapping. Typing will be re-applied later as a separate step — this upgrade is about the **Rip source** itself.

### Scope for this pass

Start with these eight packages (simple, mostly pure Rip):

1. `x12`
2. `validate`
3. `time`
4. `rsx`
5. `http`
6. `gate`
7. `decimal`
8. `csv`

**Out of scope (do not bring over):** `util`, `stamp`.

### Method (per package)

1. **Compare head-on** — v3 (`rip-lang/packages/<name>`) vs v4 (`rip/packages/<name>`): layout, entry points, Rip source, tests, and any accompanying `.d.ts` / type surface.
2. **Strip types from both sides** — remove type annotations from the Rip source and set aside the `.d.ts` / type-only files (typing comes later). What remains should be essentially Rip→Rip.
3. **Diff the stripped Rip** — how close is v4 to v3 after types are gone? Ideal outcome: nearly identical logic and structure.
4. **Judge intentional improvements** — if v4 genuinely fixes bugs, simplifies, or optimizes in a way worth keeping, call that out with the reason. If the diff is just remapping noise, file splits without payoff, or incidental churn, prefer the clean v3→v4 shape (or restore v3 Rip and drop the noise).

### Decision rule

| Situation | Action |
| --- | --- |
| Stripped Rip is essentially the same | Prefer the simple mapping; keep structure close to v3 |
| v4 has a real fix, cleanup, or better design | Keep it; document *why* |
| v4 only reorganized / remapped without benefit | Prefer the simpler v3-shaped Rip |

### Deliverable

This file grows as the analysis lands: one section per package with comparison findings, what stripping types reveals, and a keep / restore / merge recommendation.

---

## Analysis

*(Package-by-package findings go below.)*
