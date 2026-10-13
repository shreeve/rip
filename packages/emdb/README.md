<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip emdb

> **emdb from Rip — scoped transactions, named trees and ordered scans over libemdb, through bun:ffi.**

[emdb](https://github.com/shreeve/emdb) is an embedded key-value database:
a memory-mapped, copy-on-write B+ tree with MVCC, in LMDB's architecture.
This package bundles its C library, `libemdb` 0.10.1, loads it with
`bun:ffi` and binds the
twenty-one functions of its C ABI (`include/emdb.h`, emdb's SPEC §8.8);
the API below reaches all of them except the cursor writes
(`emdb_cursor_put`, `emdb_cursor_del`) and child transactions. Scans
read through `emdb_cursor_get_batch`, many entries per call. One writer
and up to `maxReaders` readers (126 by default) share a database, each
transaction a function that commits when it returns and aborts when it
throws. Keys and values are bytes;
values come back copied, or as zero-copy views on request. No C shim
sits between the two: emdb passes no struct by value, so every call is a
plain `bun:ffi` call.

**Runtime:** not browser-safe — loads `libemdb` through `bun:ffi` and
opens database files; Bun only. One `.rip` file, beside the bundled
libemdb in `lib/`.

## Quick Start

```coffee
import { open } from 'rip/emdb'

text = (bytes) -> TextDecoder.new().decode bytes

db = open 'fruit.emdb'   # creates fruit.emdb and fruit.emdb-lock

db.write (txn) ->
  txn.put 'apple', 'red'
  txn.put 'banana', 'yellow'
  txn.put 'blueberry', 'blue'

db.read (txn) ->
  console.log text(txn.get 'apple')         # red
  for [key, value] as txn.scan(prefix: 'b')
    console.log text(key), text(value)      # banana yellow, then blueberry blue

db.close()
```

## Requirements

- **Bun** on Linux x86_64 (glibc 2.17 or later) or macOS arm64.

Nothing to build or install: the package bundles libemdb 0.10.1, emdb's
C library, for those two platforms in `lib/`, and loads the one named
for the platform and architecture Bun reports. Any other platform is
refused at the first `open` with `no libemdb for <platform>-<arch>`.
`libraryPath()` names the file it loads. The binaries are emdb's, under
the AGPL-3.0, not Rip's license; `lib/README.md` gives their provenance,
build commands and checksums.

## Transactions

```coffee
total = db.write (txn) ->
  txn.put 'count', '3'
  3                       # write returns this once the commit succeeds

db.read (txn) -> txn.get 'count'
```

- `env.read fn` runs `fn(txn)` in a read transaction on the latest commit;
  `env.write fn` in the write transaction. Each returns `fn`'s result.
- Returning commits; throwing aborts, and the error is rethrown as it was.
  A commit that fails throws, and the transaction has ended either way.
- `fn` is synchronous. A returned promise aborts the transaction and
  throws a `TypeError`.
- A transaction object lives only inside its function: any method called
  after it returns throws, and so does a scan resumed after it.
- One write transaction per database at a time: a `write` inside a
  `write` is `EMDB_WRITER_ACTIVE`, also through a second environment on
  the same file in this process, which would otherwise wait forever on
  the writer lock its own process holds. A writer in another process is
  waited for. A `read` inside a `write` sees the last commit, not the
  write in flight.
- `env.write opts, fn` sets the commit's sync mode — `noSync: true`,
  `noMetaSync: true` or `sync: true` — and `stage: true` stages its
  appended pages for a bulk load. `env.sync()` makes every commit so far
  durable.

## Keys and Values

A key or value is a string (stored as UTF-8) or a `Uint8Array`, including a
`Buffer` or a `subarray` view. `get` returns a `Uint8Array`, or
`undefined` when the key is absent; decode text with a `TextDecoder`.

```coffee
db.write (txn) ->
  txn.put 'user:1', JSON.stringify(name: 'Ann')
  txn.del 'user:9'             # true when the key was there
  txn.delPrefix 'session:'     # the number of keys deleted
```

**The lifetime rule.** By default a value is copied out of the map, and
the copy is yours to keep forever. `view: true` lends the map's own bytes
instead, with no copy, and a view dies:

- when its transaction ends;
- in a write transaction, at the next `put`, `del`, `delPrefix`, `clear`,
  `drop` or `tree(..., create: true)` (emdb's API-ABI04);
- for a view scan's value, when the scan fills its batch buffer again,
  and when the scan ends or is broken out of. A scan's keys are always
  copies.

A dead view is detached: its length is 0 and `view.buffer.detached` is
true, so it reads as empty instead of as whatever the map, or a refilled
batch, holds by then.
**Never keep a view past its scope**; `view.slice()` copies one. A dead
view passed back as a key, value, prefix or `from` is refused with a
`TypeError`, never read as the empty string.

A `get` view points into the map. A scan's value view points into the
scan's batch buffer, a copy the scan reads many entries into at once, so
the views of one batch live and die together. A transaction holds every
view `get` lends until it ends, so it can detach them; a long read
transaction that takes many views keeps that many small objects.

```coffee
size = db.read (txn) ->
  big = txn.get 'image', view: true   # no copy
  big.length                          # use it here, return what you need
```

## Named Trees

```coffee
db.write (txn) ->
  users = txn.tree 'users', create: true
  txn.put 'ann', 'admin', tree: users

db.read (txn) ->
  users = txn.tree 'users'             # EMDB_NOTFOUND when missing
  txn.get 'ann', tree: users
```

A tree handle names its tree in every later transaction of the same
environment until the tree is dropped. `txn.clear tree` empties a tree;
`txn.drop tree` deletes it. emdb reuses a dropped tree's slot, so a
stale handle would name whichever tree takes it next; instead a handle
dies, and throws on use, once a commit drops its tree, or when the write
that created its tree aborts. A drop in the write in flight makes the
handle throw at once, and an abort revives it. Drops made through
another environment or process are not seen: there the stale-handle
hazard is the caller's (emdb's INV-SUB03). Each named tree has a record in the main tree,
so a scan of the main tree meets the trees' names.

## Scans

`txn.scan(options)` yields `[key, value]` pairs in key order:

```coffee
db.read (txn) ->
  for [key, value] as txn.scan()
    console.log text(key), text(value)

  txn.scan prefix: 'user:'              # keys starting with user:
  txn.scan from: 'm'                    # from the first key at or after m
  txn.scan from: 'm', reverse: true     # from the last key at or before m, down
  txn.scan tree: users, view: true      # a named tree's pairs, values zero-copy
```

`prefix` and `from` combine. Options are checked when the scan is made.
A write in the same transaction does not end a scan, which continues
after the last key it gave: deleting each key as it is visited empties
the tree. Each scan borrows a cursor and a batch buffer, and returns
them to its transaction when it finishes or is broken out of. A batch
starts small, for scans that stop early, and grows as the scan goes on;
a prefix stops it inside emdb.

## Errors

Every emdb error code is thrown as an `EmdbError`, with `code` the
negative integer of `emdb.h` and `name` its `EMDB_*` spelling; the
message names the call that returned it.

```coffee
import { open, EmdbError } from 'rip/emdb'

try
  db.read (txn) -> txn.put 'k', 'v'
catch e
  e instanceof EmdbError     # true
  e.name                     # 'EMDB_TXN_READ_ONLY'
  e.code                     # -32016
```

`EMDB_NOTFOUND` from `get` is `undefined` and from `del` is `false`; a
missing tree throws it.

**`EMDB_DURABILITY_UNKNOWN`** from a commit is the one error after which
the write stands: the commit is published and visible, and only its meta
page failed to sync. Its `EmdbError` has `committed: true` (every other
has `committed: false`). Do not retry that write. Whether it survives a
crash is unknown, and once any sync fails the environment syncs nothing
more, its later syncing commits and `env.sync()` failing with
`EMDB_SYNC_FAILED`, until it is opened again (emdb's §7.1). A misuse — an unknown option, a key that is not a
string or `Uint8Array`, a transaction used after its scope — throws a
`TypeError` or `Error` naming it.

## Environment

```coffee
db = open 'data.emdb', mapSize: 1 << 30, pageSize: 8192

db.info()      # { pageSize, mapSize, numPages, lastTxnId, entries, depth,
               #   activeReaders, maxReaders, maxKeySize }
db.read (txn) -> txn.stat()        # { depth, branchPages, leafPages, overflowPages, entries }
db.backup 'data.backup'            # a new file (removed if the backup fails); or an open
                                   # descriptor; { since: txnId } for incremental
db.close()
```

`open` takes the fields and flags of `emdb_options`:

| Option | Meaning |
| --- | --- |
| `readOnly` | read-only environment |
| `noCreate` | fail on a missing or empty file |
| `noSync`, `noMetaSync` | sync nothing at commit, or data but not the meta page |
| `noVerify` | do not check pages on first read |
| `noStage` | no transaction stages its appends |
| `previous` | open at the previous commit (with `readOnly`) |
| `populate`, `hugePages` | pre-fault the file; ask for transparent huge pages (Linux) |
| `pageSize` | a new file's page size; default the OS page size |
| `maxReaders`, `maxNamedTrees`, `sealThreads` | reader slots, named-tree handles, commit sealing threads |
| `mapSize`, `maxMapSize`, `growStep`, `stageAppendBytes` | file size, growth limit and step, staging limit, in bytes |

An unknown option, a flag that is not `true` or `false`, and a size that
is not a non-negative integer are refused. A backup restores with the
emdb command: `emdb -r data.emdb data.backup`.

## API Summary

| Call | Returns |
| --- | --- |
| `open(path, options)` | `Env` |
| `version()` | libemdb's version, `'0.10.1'` |
| `libraryPath()` | the bundled libemdb file for this platform |
| `env.read(fn)` / `env.write([options,] fn)` | `fn`'s result |
| `env.info()` / `env.sync()` / `env.backup(target, {since})` / `env.close()` | info / — / backup stats / — |
| `txn.get(key, {tree, view})` | `Uint8Array` or `undefined` |
| `txn.put(key, value, {tree})` | — |
| `txn.del(key, {tree})` / `txn.delPrefix(prefix, {tree})` | `true`/`false` / count |
| `txn.tree(name, {create})` | tree handle |
| `txn.clear(tree)` / `txn.drop(tree)` | — |
| `txn.stat(tree)` | stat (main tree when omitted) |
| `txn.scan({tree, prefix, from, reverse, view})` | iterator of `[key, value]` |
| `EmdbError` | `code`, `name`, `message`, `committed` |

## Performance

```bash
bun run bench              # 1,000,000 entries; rip bench.rip <n> for another size
```

`bench.rip` runs each operation on 1M entries (16-byte keys, 32-byte
values; neither engine syncs) beside the same work through `bun:sqlite`,
which is built into Bun. Measured on an Apple M5 under Bun 1.4.3 with
libemdb from emdb `636d6cd`, whose code the bundled 0.10.1 is (0.10.1
only strips the shared library), the median of three runs of best-of-three,
alongside other work on the machine, so read the rows as a ranking:

| Operation | emdb | ns/op | bun:sqlite | ns/op |
| --- | ---: | ---: | ---: | ---: |
| put (one transaction) | 40 ms | 40 | 442 ms | 442 |
| get, key order | 48 ms | 48 | 1334 ms | 1334 |
| get, random order | 502 ms | 502 | 2549 ms | 2549 |
| get, `view: true` | 243 ms | 243 | — | |
| scan | 68 ms | 68 | 77 ms | 77 |
| scan, `view: true` | 50 ms | 50 | — | |
| delPrefix, every key | 2 ms | 2 | 145 ms | 145 |
| get 64 KB value (10,000) | 84 ms | 8377 | 965 ms | 96456 |
| get 64 KB value, `view: true` | 59 ms | 5948 | — | |

On Linux x86_64 (an Intel Core Ultra 9 185H) under Bun 1.4.3, with libemdb
from emdb `636d6cd` built for x86_64_v3, pinned to one performance core on
a machine reserved for the run, the median of three runs. The bundled
library is built for baseline x86-64; on the same machine, reserved,
baseline, x86_64_v2 and x86_64_v3 builds of 0.10.1 measure the same within
run-to-run noise on every row:

| Operation | emdb | ns/op | bun:sqlite | ns/op |
| --- | ---: | ---: | ---: | ---: |
| put (one transaction) | 99 ms | 99 | 630 ms | 630 |
| get, key order | 77 ms | 77 | 428 ms | 428 |
| get, random order | 743 ms | 743 | 1725 ms | 1725 |
| get, `view: true` | 571 ms | 571 | — | |
| scan | 79 ms | 79 | 179 ms | 179 |
| scan, `view: true` | 86 ms | 86 | — | |
| delPrefix, every key | 4 ms | 4 | 190 ms | 190 |
| get 64 KB value (10,000) | 319 ms | 31935 | 764 ms | 76431 |
| get 64 KB value, `view: true` | 257 ms | 25707 | — | |

A copied `get` is one `memcpy` (from the libc libemdb links) into a
fresh `Uint8Array`. A `get` view needs an external `ArrayBuffer` and a
detach when it dies, which costs more than copying a small value, so it
pays only for large values, and less than it might, since emdb assembles
a value spanning overflow pages into the transaction's own copy. A scan
reads a batch of entries per call; its copies are `slice`s of the batch,
and its views subarrays of it, with one detach per batch.

## Test

```bash
bun run test
```

The suite runs against the real libemdb: loading and its errors, keys and
values, transaction scope and lifetime, named trees, scans in both
directions, overflow values, stat and info, error mapping and backups.
