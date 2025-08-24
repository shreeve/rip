# MOONSHOT — Building a Production‑Grade, Hospital‑Ready MUMPS System (bumps)

> **Goal**: deliver a modern, reliable, and interoperable MUMPS (M) platform suitable for hospital workloads (e.g., VistA‑class apps), with strong correctness guarantees, observability, and operational discipline.  
> **Core tenets**: *compatibility first*, *lossless parsing (spans everywhere)*, *deterministic storage*, *observability by default*, *secure by default*.

---

## Executive Summary

This document lays out the **end‑to‑end plan** to evolve `@rip/bumps` from a fast parser/formatter into a **full runtime** with a persistent **globals engine**, **concurrency/locking**, **devices/I/O**, and **enterprise‑grade operations** (journaling, backup/restore, replication, monitoring), together with **tooling** (CLI, LSP), **compliance/security** (HIPAA‑aligned controls), and **conformance** (M standard behavior, common extensions).

Delivery is sequenced into phases; each phase has outcomes, effort, and **checklists**. Estimates below assume **senior engineers** with domain context; adjust for team mix.

---

## Scope & Non‑Goals

**In‑scope**
- M/MUMPS language compatible execution of core commands and operators.
- Durable, crash‑safe **globals** store (with journaling + recovery).
- Host‑level **process model** approximating classic M task semantics.
- **I/O devices**: terminal, files; later sockets/serial as needed.
- **Locking** semantics compatible with M (`LOCK`), with timeouts.
- **Tooling**: CLI, formatter, linter, LSP (hover/defs/rename/refs/format).
- **Ops**: backup/restore, online journaling mgmt, metrics + logs, SRE runbooks.
- **Security**: encryption in transit, at rest, audit trail, RBAC shells.
- **Interoperability**: HL7 v2 emit/ingest helpers; optional FHIR REST gateway.

**Out‑of‑scope (initial)**
- Proprietary vendor extensions (full IRIS/GT.M parity). We’ll prioritize the most used “Z‑commands” and provide stubs.
- Full terminal emulation suites; we’ll implement the subset needed by target apps.
- Distributed SQL/OLAP. (We focus on globals; can integrate external engines later.)

---

## Phase Map (Top‑Level)

| Phase | Title | Outcome | Effort (PM) | Primary Risk |
|------:|------|---------|-------------:|--------------|
| 0 | **Parser/Foundation** | Zig lexer + JS parser, lossless AST, formatter | **Done/ongoing** | Low |
| 1 | **Language Core** | Evaluator for expressions & ~12 core commands | 6–10 | Semantics gaps |
| 2 | **Globals Engine** | Durable key‑value tree with M collation, journaling, crash recovery | 10–16 | Data integrity |
| 3 | **Concurrency & Locks** | Process model, `JOB`, `LOCK`, timeouts, deadlock handling | 6–10 | Races & deadlocks |
| 4 | **Devices / I/O** | Terminal, files, `$I`, `READ/WRITE/OPEN/USE/CLOSE` | 5–8 | OS quirks |
| 5 | **Tooling (CLI/LSP)** | `bumps` CLI, LSP server, linter, code actions | 6–9 | Editor parity |
| 6 | **Operations** | Backups, journaling ops, replication (async), metrics/logs | 8–12 | Recovery paths |
| 7 | **Security & Compliance** | TLS, at‑rest encryption, audits, HIPAA alignment | 5–9 | Threat model gaps |
| 8 | **Interoperability** | HL7 v2 toolkit; optional FHIR facade | 4–7 | Data correctness |
| 9 | **Conformance & Perf** | Standard coverage, test suites, perf gates | 6–10 | Legacy edge cases |

> **Rough total**: 56–91 person‑months (PM). Parallelize by phase: e.g., Globals Engine (2) in parallel with Language Core (1) after AST is stable; Tooling (5) can run alongside.

---

## Phase 0 — Parser/Foundation (Status: ✅)

**Outcomes**
- High‑perf **Zig lexer** + **JS parser** with *spans everywhere*.
- Robust **formatter** (compact by default; opt‑in alignment).
- Deterministic line & command chunking; ambiguous `H` resolved.
- CLI skeleton: `format/parse/tokens/bench`.

**Checklist**
- [x] Lossless spans (`_start/_end`) on all nodes.
- [x] Token path O(tokens_in_line), no O(N²).
- [x] Pattern `?` mini‑AST (counts, classes, literals).
- [x] Ambiguous `H` rule: args→`HANG`, else `HALT`.
- [x] Formatter defaults compact; options documented.

**Quality gates**
- [x] Golden test corpus (fixtures).
- [x] Fuzz inputs (random quotes, nested parens, commas).

---

## Phase 1 — Language Core (Evaluator)

**Goal**: Execute M lines with correct operator semantics and core commands.

**Scope**
- **Operators/expressions**: left‑to‑right evaluation; string/num coercion; pattern engine.
- **Core commands** (initial 12): `SET`, `NEW`, `KILL`, `MERGE`, `IF`, `DO`, `GOTO`, `QUIT`, `WRITE`, `READ`, `OPEN`, `USE`, `CLOSE`, (`HALT/HANG` resolved).
- `$` functions: start with `$L`, `$P`, `$E`, `$F`, `$D`, `$I`, `$J`, `$T`, extend per app needs.
- **XECUTE**: evaluate text argument in current context (safe mode first).

**Effort**: **6–10 PM** (with parser stable).

**Complexity/Risks**
- M’s coercion and truthiness rules (edge cases).
- Pattern operator correctness (range/class semantics).

**Checklist**
- [ ] Expression VM with LTR evaluation and coercion suite.
- [ ] Pattern engine matching full grammar (counts/class/lit).
- [ ] Command dispatcher + per‑command implementations.
- [ ] `$` fn table with span‑aware args.
- [ ] XECUTE sandbox (disable file/network until Phase 4).

**Debugging needs**
- [ ] Trace mode (`set -x`‑like) logging per line with spans.
- [ ] Deterministic seeds for randomness/timeouts.

**Exit criteria**
- [ ] Pass conformance tests for operators & listed commands.
- [ ] 95%+ of VistA core macro usage covered (sampled).

---

## Phase 2 — Globals Engine (Persistence)

**Goal**: Durable `^global(sub1,sub2,...) = value` store with M collation and crash safety.

**Design options**
- **LMDB** (B+tree, MVCC) shim for M collation and atomic updates.
- **RocksDB** (LSM) with custom comparator (more tuning).
- **Custom B‑tree** (Zig) for full control (more time, highest determinism).

**Core requirements**
- **Collation**: exact M‑style subscript ordering (numeric vs string, nulls).
- **Atomicity & Isolation**: multi‑op atomic batch; writer isolation.
- **Journaling**: write‑ahead log; **crash‑safe** replay; **online backup**.
- **Recovery**: idempotent replay; torn‑write detection.
- **Locking hooks**: integrate with Phase 3 lock table.

**Effort**: **10–16 PM**.

**Complexity/Risks**
- Data corruption on crash; replay edge cases.
- Correct comparator for mixed types and leading zeros.

**Checklist**
- [ ] Collation comparator (unit tests with canonical vectors).
- [ ] Put/Get/Next/Prev/KeyRange APIs with `^` namespace separation.
- [ ] Atomic batch API + transaction boundaries.
- [ ] WAL (journal) format + fsync discipline.
- [ ] Recovery tool + timeline/documentation.
- [ ] Online backup/restore (hot copy of DB + journal).

**Exit criteria**
- [ ] Crash‑recovery torture tests (power‑cut simulation).
- [ ] 100K+ **puts/sec** sustained on commodity hardware.
- [ ] Journal replays 100% deterministically under fuzz.

---

## Phase 3 — Concurrency & Locks

**Goal**: M‑style process/task model with `JOB`, `LOCK`, timeouts, and safe shutdown.

**Scope**
- Process **isolation** per job (address space / worker threads with isolates).
- `LOCK` behavior: hierarchical names, timeouts, blocking, forced release on exit.
- **Deadlock** detection (wait‑for graph) with metrics + dumps.
- **Signals**: graceful halt, shutdown hooks, journal flush.

**Effort**: **6–10 PM**.

**Complexity/Risks**
- Priority inversion; starvation; correctness under contention.

**Checklist**
- [ ] Lock table service (in‑proc first; IPC later).
- [ ] `LOCK` acquire/release/timeout semantics + tests.
- [ ] JOB launcher (per‑job isolate/process) with stdio plumbed.
- [ ] Shutdown sequence: deny new locks → flush → stop.  
- [ ] Contention metrics & deadlock detector with dumps.

**Exit criteria**
- [ ] Soak test: 24h mixed workload, no leaks, no deadlocks.
- [ ] LOCK timing conformance within ±10ms targets.

---

## Phase 4 — Devices / I/O

**Goal**: Usable terminals and files with `$I`, `READ`, `WRITE`, `OPEN`, `USE`, `CLOSE` semantics.

**Scope**
- **Terminal**: cooked/raw, echo, timeout handling; mapping to `$I` and device params.
- **Files**: line/record modes; encodings; append/overwrite; errors.
- **Sockets (optional beta)**: for HL7 over TCP use‑cases.

**Effort**: **5–8 PM**.

**Complexity/Risks**
- Cross‑platform TTY quirks; Unicode and byte‑level expectations.

**Checklist**
- [ ] Device registry; current device context; `$I`.
- [ ] READ: timeout, maxlen, prompt variants.
- [ ] WRITE: strings, numbers, mnemonics (`!`, `?expr`).
- [ ] OPEN/USE/CLOSE: switch device, modes, failures.
- [ ] File path sandboxing per security policy.

**Exit criteria**
- [ ] Deterministic behavior across Linux/macOS.
- [ ] 100% green on device behavior tests (fixtures).

---

## Phase 5 — Tooling (CLI, LSP, Lint)

**Goal**: First‑class developer experience.

**Scope**
- `bumps` CLI: `format`, `parse`, `run`, `bench`, `db` (backup/restore/journal).
- **LSP**: hover, go‑to‑def, rename, references, diagnostics, organize & format.
- **Linter**: suspicious pattern checks, dead code hints, style rules.

**Effort**: **6–9 PM**.

**Complexity/Risks**
- LSP performance on large codebases; incremental index correctness.

**Checklist**
- [ ] LSP server (Node/Bun) with incremental index by file.
- [ ] AST index: labels/tags, routines, global usage map.
- [ ] Rename/refs with span‑aware edits; formatting code actions.
- [ ] CLI UX and help, error codes, non‑zero exits on failures.

**Exit criteria**
- [ ] VS Code & Cursor extensions published.
- [ ] 50k+ LOC project responsive (<200ms nav ops).

---

## Phase 6 — Operations (Prod‑Readiness)

**Goal**: Reliable operations for hospitals (HA mindset).

**Scope**
- **Backup/restore** (hot): copy DB + journal; point‑in‑time restore.
- **Replication** (async): ship journal to a follower/DR site.
- **Observability**: Prometheus metrics, structured logs, health checks.
- **Runbooks**: crash recovery, journal pruning, restore/DR guides.

**Effort**: **8–12 PM**.

**Complexity/Risks**
- Data loss windows; DR RPO/RTO commitments.

**Checklist**
- [ ] `bumps db backup|restore|replay|verify` commands.
- [ ] Replication service (journal shipper + applier).
- [ ] Metrics: db ops, fsync lat, lock waits, heap/GC, job counts.
- [ ] Log schema; correlation IDs; trace hooks.
- [ ] SRE runbooks for all red paths.

**Exit criteria**
- [ ] PIT restore proven in practice (drill).
- [ ] 99.9% uptime under controlled failovers.

---

## Phase 7 — Security & Compliance

**Goal**: HIPAA‑aligned posture; protect PHI by default.

**Scope**
- **TLS** for all network endpoints; FIPS‑capable crypto build.
- **At‑rest encryption** (journal + DB) with key rotation.
- **Audit logging**: all accesses/changes with actor & span context.
- **RBAC** shell: limit device/file access based on role.
- **Data retention** policy + secure wipe tools.

**Effort**: **5–9 PM**.

**Complexity/Risks**
- Key management; audit trail tamper evidence.

**Checklist**
- [ ] TLS termination + mTLS option; cipher suites policy.
- [ ] KMS integration (HashiCorp Vault or OS keystore); key rotation.
- [ ] Audit log schema; signed/hashed append‑only journal.
- [ ] Config policy: device/file whitelist, path sandboxing.
- [ ] Security review/threat model doc; pentest fixes.

**Exit criteria**
- [ ] HIPAA checklist green; SOC2 controls mapped.
- [ ] Audit replay tooling validated.

---

## Phase 8 — Interoperability (HL7/FHIR)

**Goal**: Get data in/out safely.

**Scope**
- **HL7 v2** parse/build utilities; TCP MLLP helpers.
- **FHIR facade**: optional HTTP server mapping globals to REST resources.

**Effort**: **4–7 PM**.

**Complexity/Risks**
- Data mapping correctness; field encoding issues.

**Checklist**
- [ ] HL7 v2 codec (ACK/NAK helpers).
- [ ] MLLP server/client with backpressure & retries.
- [ ] FHIR resource mapping layer (config‑driven).
- [ ] Example adapters (ADT, ORU).

**Exit criteria**
- [ ] Interop test rigs pass (HL7 v2 sample corpus).
- [ ] Basic FHIR CRUD works on sample globals schema.

---

## Phase 9 — Conformance & Performance

**Goal**: Standards coverage and predictable performance envelopes.

**Scope**
- **Conformance**: M standard behaviors, edge cases; most common Z‑extensions stubbed or implemented per demand.
- **Performance gates**: parse MB/s, DB ops/s, lock latencies, device throughput.

**Effort**: **6–10 PM**.

**Checklist**
- [ ] Conformance harness (public tests + our fixtures).
- [ ] Compatibility layer for common Z‑cmds (configurable).
- [ ] Benchmarks: parse (pure‑JS vs Zig+JS), DB ops, locks, IO.
- [ ] Perf dashboards; regression alarms.

**Exit criteria**
- [ ] Zero regressions over a month of nightly benches.
- [ ] Meets perf SLOs (see below).

---

## Target SLOs & Benchmarks

- **Parser**: Zig‑lex + JS parse **≥ 150 MB/s** on mixed code; JS‑only **≥ 80 MB/s**.
- **Globals**: ≥ **100K puts/sec**, ≥ **200K gets/sec** per node (NVMe).
- **Journaling**: fsync latency p95 ≤ **15 ms**; sustained write ≥ **50 MB/s**.
- **Locks**: non‑contended acquire/release ≤ **50 µs**, p99 ≤ **1 ms** under load.
- **Startup**: cold start ≤ **500 ms**, hot ≤ **150 ms**.
- **Crash recovery**: journal replay ≤ **60 s** for 10 GB journal; zero data corruption.

---

## Risk Register (selected)

- **Data integrity** (WAL bugs) → double‑write barrier, invariants, chaos drills.
- **Deadlocks** → wait‑for graph + dumps, kill‑switch, timeouts.
- **Performance cliffs** → perf tests in CI with alarms; budget envelopes.
- **Compatibility gaps** → conformance harness + Z‑cmd selectively.

---

## Engineering Practices

- **Design docs for each phase** (approved before coding).
- **Golden tests** for every bugfix (never regress).
- **Fuzzers** for parser, pattern engine, journal decoder.
- **Observability first**: structured logs, histogram metrics everywhere.
- **Roll‑forward bias**: online migrations; backward‑compat WAL.
- **Security reviews** at Phase 6–7 boundaries.

---

## Milestone Checklists

### M0 — Foundation (✅)
- [x] Parser/formatter complete; CLI skeleton; basic benches.

### M1 — Executable Core
- [ ] Expression VM + pattern engine.
- [ ] Command impls (`SET/NEW/KILL/MERGE/IF/DO/GOTO/QUIT/WRITE/READ/OPEN/USE/CLOSE`).
- [ ] `$` functions (initial set).

### M2 — Durable Storage
- [ ] Collation comparator; iterator API; atomic batch.
- [ ] WAL + recovery; online backup.
- [ ] Data integrity tests; crash sim.

### M3 — Concurrency
- [ ] Lock table; deadlock detector; JOB isolation.
- [ ] Shutdown + flush; soak tests.

### M4 — Devices
- [ ] Terminal + files; `$I` semantics; timeouts.
- [ ] Cross‑platform parity tests.

### M5 — Tooling
- [ ] LSP (hover/defs/rename/refs/format).
- [ ] Linter; code actions; docs & samples.

### M6 — Ops
- [ ] Backup/restore CLI; journaling mgmt.
- [ ] Replication (async); dashboards; runbooks.

### M7 — Security
- [ ] TLS/mTLS; at‑rest encryption; KMS.
- [ ] Audit trail; RBAC configs; threat model.

### M8 — Interop
- [ ] HL7 v2 toolkit; MLLP server/client.
- [ ] Optional FHIR facade.

### M9 — Conformance/Perf
- [ ] Conformance harness green.
- [ ] Perf SLOs met; alarms in CI.

---

## Team & Timeline (example)

- **Core team**: 4 senior engineers + 1 SRE + 0.5 security + 0.5 tech writer.
- **Duration**: ~9–12 months to M9 with overlap/parallelization.
- **Parallelizable tracks**: (1) Language Core, (2) Globals Engine, (5) Tooling, (6) Ops.

---

## Getting Started Now

1. **Lock the AST** (spans & node kinds) — freeze schema v1.0.
2. **Kick off Phase 1 & 2 in parallel**: evaluator VM + globals prototype (LMDB first).
3. **Start CI perf benches** now to catch regressions early.
4. **Write the disaster‑recovery drill doc** before journaling code lands.

---

*This document is living; update after each design review.*
