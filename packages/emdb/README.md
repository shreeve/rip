<img src="https://raw.githubusercontent.com/shreeve/rip/main/docs/assets/rip.png" alt="Rip" width="50" />

# Rip emdb

> **emdb from Rip — scoped transactions, named trees and ordered scans over libemdb, through bun:ffi.**

[emdb](https://github.com/shreeve/emdb) is an embedded key-value database:
a memory-mapped, copy-on-write B+ tree with MVCC, in LMDB's architecture.
This package loads its C library, `libemdb`, with `bun:ffi` and binds the
whole C ABI (`include/emdb.h`, emdb's SPEC §8.8): one writer and any
number of readers per database, each transaction a function that commits
when it returns and aborts when it throws. Keys and values are bytes;
values come back copied, or as zero-copy views on request. No C shim
sits between the two: emdb passes no struct by value, so every call is a
plain `bun:ffi` call.

**Runtime:** not browser-safe — loads `libemdb` through `bun:ffi` and
opens database files; Bun only. One `.rip` file.

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

- **Bun**, which runs Rip.
- **libemdb**, the shared library an emdb build installs: in an emdb
  checkout, `zig build` (Zig 0.17) writes `lib/libemdb.dylib` on macOS or
  `lib/libemdb.so` on Linux, and `lib/pkgconfig/emdb.pc`.

The first `open` (or `version`) loads the library, from the first of
these that names one:

1. the `lib` option of `open` — a path to the library file;
2. `EMDB_LIB` — a path to the library file;
3. `pkg-config --variable=libdir emdb` — put an emdb checkout's
   `lib/pkgconfig` on `PKG_CONFIG_PATH`;
4. a sibling emdb checkout: `emdb/lib/` in the directory that holds this
   Rip checkout (`<dir>/rip` beside `<dir>/emdb`).

An explicit path (1 or 2) that names no file fails on that path; it never
falls through to the others. When none finds a library, the error lists
every place tried. A process loads one libemdb: a `lib` option naming a
different file after the first load is refused.

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
  `write` is `EMDB_WRITER_ACTIVE`. A `read` inside a `write` sees the last
  commit, not the write in flight.
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
- for a scan's pair, at that scan's next step.

A dead view is detached: its length is 0 and `view.buffer.detached` is
true, so it reads as empty instead of as whatever the map holds by then.
**Never keep a view past its scope**; `view.slice()` copies one.

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
`txn.drop tree` deletes it. Each named tree has a record in the main tree,
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
  txn.scan tree: users, view: true      # a named tree's pairs, zero-copy
```

`prefix` and `from` combine. Options are checked when the scan is made.
A write in the same transaction does not end a scan, which continues
after the last key it gave: deleting each key as it is visited empties
the tree. Each scan borrows a cursor, and returns it to its transaction
when it finishes or is broken out of.

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
missing tree throws it. A misuse — an unknown option, a key that is not a
string or `Uint8Array`, a transaction used after its scope — throws a
`TypeError` or `Error` naming it.

## Environment

```coffee
db = open 'data.emdb', mapSize: 1 << 30, pageSize: 8192

db.info()      # { pageSize, mapSize, numPages, lastTxnId, entries, depth,
               #   activeReaders, maxReaders, maxKeySize }
db.read (txn) -> txn.stat()        # { depth, branchPages, leafPages, overflowPages, entries }
db.backup 'data.backup'            # a new file; or an open descriptor; { since: txnId } for incremental
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
| `lib` | the libemdb file to load |

An unknown option, a flag that is not `true` or `false`, and a size that
is not a non-negative integer are refused. A backup restores with the
emdb command: `emdb -r data.emdb data.backup`.

## API Summary

| Call | Returns |
| --- | --- |
| `open(path, options)` | `Env` |
| `version()` | libemdb's version, `'0.10.0'` |
| `env.read(fn)` / `env.write([options,] fn)` | `fn`'s result |
| `env.info()` / `env.sync()` / `env.backup(target, {since})` / `env.close()` | info / — / backup stats / — |
| `txn.get(key, {tree, view})` | `Uint8Array` or `undefined` |
| `txn.put(key, value, {tree})` | — |
| `txn.del(key, {tree})` / `txn.delPrefix(prefix, {tree})` | `true`/`false` / count |
| `txn.tree(name, {create})` | tree handle |
| `txn.clear(tree)` / `txn.drop(tree)` | — |
| `txn.stat(tree)` | stat (main tree when omitted) |
| `txn.scan({tree, prefix, from, reverse, view})` | iterator of `[key, value]` |
| `EmdbError` | `code`, `name`, `message` |

## Test

```bash
bun run test
```

The suite runs against the real libemdb: loading and its errors, keys and
values, transaction scope and lifetime, named trees, scans in both
directions, overflow values, stat and info, error mapping and backups.
