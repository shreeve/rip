# Vendored: Yoga's generated layout tests

- **Upstream:** [facebook/yoga](https://github.com/facebook/yoga)
- **Path:** `javascript/tests/generated/*.test.ts` (26 files, 543 cases)
- **Commit:** `9d159f2d3d8dbc777e1f82c20b94e369c113d608`
- **State:** unmodified — every file is byte-identical to upstream at
  that commit, license headers included. `cmp` against a checkout of
  that commit is the proof.
- **License:** MIT, © Meta Platforms, Inc. and affiliates. The text is
  in [`LICENSE`](LICENSE), copied from the root of the upstream
  repository.

Nothing in this directory is edited by hand. The runner
(`../yoga.rip`) reads these files as text and cuts each case before its
right-to-left pass in memory; the files on disk stay as upstream wrote
them. To refresh, copy the directory again from a newer upstream commit
and update the commit above.

# Ported: Yoga's hand-written tests

Two files beside this directory port hand-written upstream tests, at
the same commit and under the same license, through the same shim
(`../yoga-shim.rip`). Neither is a copy: each case is rewritten in Rip
under its upstream name, one call for one, and asserts what upstream
asserts.

- `../yoga-aspect.rip` — `tests/YGAspectRatioTest.cpp`, 37 cases.
- `../yoga-hand.rip` — 53 cases:

| Upstream file | cases | ported | |
|---|---:|---:|---|
| `tests/YGMeasureTest.cpp` | 29 | 26 | the three left out assert the C API's guards (a child under a measured node, a measure function on a parent, a null one), which the shim would answer, not the engine |
| `tests/YGMeasureCacheTest.cpp` | 6 | 6 | `remeasure_with_already_measured_value_smaller_but_still_float_equal` holds 2 measurements where upstream asserts 1: the cache here compares exactly (PLAN §5) |
| `tests/YGMeasureModeTest.cpp` | 10 | 10 | |
| `tests/YGRoundingMeasureFuncTest.cpp` | 3 | 3 | at a point scale factor of 1, the only grid a terminal has; the third case is laid out upstream at a scale of 2 alone, and holds `yoga-layout` 3.2.1's boxes at 1 |
| `javascript/tests/YGMeasureTest.test.ts` | 2 | 1 | the other is `dont_measure_single_grow_shrink_child`, ported from the C++ |
| `javascript/tests/YGMeasureCacheTest.test.ts` | 1 | 0 | `measure_once_single_flexible_child`, ported from the C++ |
| `javascript/tests/YGDirtiedTest.test.ts` | 4 | 4 | the dirty flag is the element's own; the shim's `setDirtiedFunc` hears it go up |
| `javascript/tests/YGComputedPaddingTest.test.ts` | 1 | 1 | left-to-right half |
| `javascript/tests/YGComputedBorderTest.test.ts` | 1 | 1 | left-to-right half |
| `javascript/tests/YGComputedMarginTest.test.ts` | 1 | 1 | left-to-right half; the engine keeps no resolved margin, so the case reads it in the root's position |

Not ported, because the engine has no such member for the shim to
carry:

- `javascript/tests/YGAlignBaselineTest.test.ts` — both cases turn on
  `setIsReferenceBaseline`.
- `javascript/tests/YGHadOverflowTest.test.ts` — `getComputedHadOverflow`.
- `javascript/tests/YGHasNewLayout.test.ts` — `hasNewLayout` and
  `markLayoutSeen`; a node here tells of a new box through its reactive
  `box`, which writes only when the box differs.
- `javascript/tests/YGFlexBasisAuto.test.ts` — reads a style back
  (`getFlexBasis`), which only the shim's own record would answer.
- `javascript/tests/YGErrataTest.test.ts` — errata are out of scope.
