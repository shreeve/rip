# libemdb for Rip emdb

These are emdb's shared C library, `libemdb`, built for the platforms
`rip/emdb` supports. The package loads the one named for the platform
and architecture Bun reports (`process.platform`, `process.arch`); there
is no other lookup.

**License:** these binaries are [emdb](https://github.com/shreeve/emdb),
licensed under the GNU Affero General Public License v3.0 (emdb's
`LICENSE`). They are not covered by Rip's license.

## Provenance

- emdb 0.10.1, commit `TAG-COMMIT` (to be filled in at the v0.10.1 tag)
- Zig 0.17.0
- The C library is always built on a ReleaseFast engine, whatever
  `-Doptimize` says, and the shared one is stripped, its exports kept in
  the dynamic symbol table. The build installs it to `<prefix>/../lib`,
  so each target takes a `--prefix` of its own.

From an emdb checkout at that commit:

```bash
zig build --prefix /tmp/emdb-linux-x64/p -Dtarget=x86_64-linux-gnu.2.17
cp /tmp/emdb-linux-x64/lib/libemdb.so libemdb-0.10.1-linux-x64.so

zig build --prefix /tmp/emdb-darwin-arm64/p     # on an arm64 Mac (aarch64-macos)
cp /tmp/emdb-darwin-arm64/lib/libemdb.dylib libemdb-0.10.1-darwin-arm64.dylib
```

The Linux library is built with no `-Dcpu`, so for baseline x86-64, and
needs glibc 2.17 or later; the macOS one is for arm64.

| File | Size (bytes) | sha256 |
| --- | ---: | --- |
| `libemdb-0.10.1-linux-x64.so` | 242320 | `abef39200fb0e6b3b5098c3c0aece1a2f6b6ee857299c1ad8d054745ba27fa61` |
| `libemdb-0.10.1-darwin-arm64.dylib` | 234800 | `dab1d93951a74f994cbfc50ee0476123067fe4a29c4639a51315cbe5ae9fb9af` |
