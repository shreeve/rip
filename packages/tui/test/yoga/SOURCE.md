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
