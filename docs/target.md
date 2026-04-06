# Zig Target Analysis

## Purpose

This document catalogs the Zig language features and patterns found in a real-world embedded codebase (`pico/src` — RP2040/RP2350 firmware with Wi-Fi, USB host, cooperative runtime, and MQuickJS integration). The goal is to inform which Zig constructs Rip must be able to generate, in what order.

The analysis covers 48 Zig source files spanning bare-metal boot code, hardware abstraction, networking, and JavaScript FFI.

## Zig Constructs Catalog

### Types and Layout

- **`struct`** — the dominant organizational unit (devices, endpoints, events, configs)
- **`extern struct`** — USB descriptors, C interop shim structs
- **`opaque`** — forward-declared C types (`JSContext`)
- **`enum` / `enum(T)`** — state machines everywhere (`DeviceState`, `DhcpState`, `Speed` as `enum(u2)`, `TransferStatus` as `enum(u8)`)
- **Integer widths as types** — `u1` for USB data PID, `u5` for GPIO pin indices
- **Tagged unions** — not used in this codebase (notable absence)

### Error Handling

- **Named error sets** — `desc.Error`, `types.Error`, `EvalError`
- **Merged error sets** — `desc.Error || error{ ... }`
- **`anyerror`** — function pointer types, logging
- **Error unions** — `Error!T`, `!void`, `types.Error!void`, `EvalError!JSValue`
- **`try` / `catch` / `catch |err|` / `catch {}`** — pervasive

### Optionals

- **`?T`** — pointers (`?*Endpoint`), slices, callbacks (`?ConnectCallback`), C interop (`?*c.JSContext`)
- **`orelse`** — default values
- **`if (opt) |val|`** — unwrapping pattern, ubiquitous in JS glue and config loading

### Control Flow

- **`while`** — digit printing, protocol loops, DHCP, boot delays, event loop, ring-buffer dequeue
- **`while (i < n) : (i += 1)`** — counted loops
- **`for`** — `for (s) |ch|`, `for (0..n) |i|`, `for (&array, 0..) |*ep, i|`, `for (slice) |maybe|`
- **`switch`** — on enums, chip variants, poll results
- **`defer`** — critical section cleanup (IRQ disable/re-enable)
- **`continue`** — retry loops
- **`unreachable`** — after infinite loops, exhaustive switches
- **`errdefer`** — not used in this codebase

### Memory and Pointers

- **Slices** — `[]const u8`, `[]u8` used universally for buffers and strings
- **Pointer types** — `*T`, `*const T`, `[*]T`, `[*]const T`, `[*]volatile`, `?*anyopaque`
- **Sentinel pointers** — `[*:0]const u8` for C string interop
- **Custom bump allocator** — `Region { base, size }`, 8-byte alignment, no individual free
- **Linker-defined heap** — `extern var _heap_start`, `_heap_end`
- **No `std.mem.Allocator`** — replaced by custom pool
- **`align(N)`** — on variables for hardware requirements
- **`@memcpy` / `@memset`** — bulk operations

### Comptime and Metaprogramming

- **`comptime` blocks** — force module inclusion, vector table generation
- **`comptime T: type`** — generic descriptor read/cast functions
- **`inline` functions** — MMIO register helpers, hot path accessors
- **`inline for`** — small fixed-count loops
- **`@sizeOf` / `@embedFile`** — descriptor sizing, firmware blob embedding
- **Conditional imports** — `switch (chip) { ... => @import(...) }`
- **`@hasDecl`** — optional root module feature detection
- **No `@Type`** — full reflection not used

### Interop

- **`export fn`** — ISRs, JS native functions
- **`extern fn`** — C API declarations (MQuickJS)
- **`extern var` / `extern const`** — linker symbols
- **`callconv(.c)`** — ISRs, C callbacks, panic
- **Function pointers** — callbacks, vtable-style dispatch (`*const fn (...) void`)

### Casts and Builtins

- **`@ptrCast` / `@alignCast`** — MMIO, descriptor views
- **`@ptrFromInt` / `@intFromPtr`** — register addresses
- **`@constCast`** — const-correctness for transfers
- **`@bitCast`** — signed value parsing from raw bytes
- **`@truncate` / `@intCast` / `@as`** — width and sign handling
- **`@intFromEnum`** — enum to integer conversion

### Other

- **`noreturn`** — boot, panic, event loop entry
- **`@panic`** — descriptor cast guards
- **Struct init shorthand / defaults** — `self.* = .{}`
- **Array repeat** — `[_]T{x} ** n`
- **Inline assembly** — `asm volatile` for `nop`, `wfi`, `cpsid`, vector tables

## Common Patterns

- **Structs with methods** as the primary organizational unit
- **State machines** — enum + switch dispatch (DHCP, TCP, Wi-Fi, USB)
- **Vtable / dependency injection** — large Context structs with function pointer fields
- **Cooperative runtime** — ring buffers, timer wheel, FIFO task queue
- **ISR → main deferred work** — NVIC disable/enable around queue + defer
- **Fixed buffers, no heap churn** — static `var` arrays, preallocated buffers
- **C API shim layer** — hand-written declarations instead of `@cImport`
- **Optional feature detection** — `@hasDecl` for conditional root hooks

## Priority for Rip

### Tier 1 — Express soon

These are pervasive and fundamental across every file:

- **Structs with methods** — the dominant organizational pattern
- **Enums** — state machines in every subsystem
- **Error sets and error unions** — `try`/`catch`/`Error!T` are pervasive
- **Optionals** — `?T`, `orelse`, `if (opt) |val|` in most functions
- **while / for loops** — iteration is everywhere
- **Slices** — `[]const u8` is the core data abstraction
- **defer** — critical section and cleanup patterns
- **switch** — on enums, variants, results

### Tier 2 — Needed for real systems work

Used heavily in HAL, USB, and driver layers:

- **Pointers** — `*T`, `*const T`, `[*]T`, `?*anyopaque`
- **comptime generics** — `comptime T: type` for generic parsing
- **inline functions** — MMIO hot paths
- **extern / export** — C interop and ISRs
- **@builtins** — `@ptrCast`, `@alignCast`, `@embedFile`, `@memcpy`
- **Volatile** — `*volatile u32` for registers
- **Calling conventions** — `callconv(.c)`
- **Function pointers** — callbacks, vtables

### Tier 3 — Defer

Less common or highly specialized:

- **Inline assembly** — vector tables, `wfi`, `nop`
- **Linker symbols** — `extern var` from linker scripts
- **Sentinel pointers** — `[*:0]const u8`
- **noreturn** — boot/panic
- **@hasDecl** — conditional feature detection

## Notable Absences

These common Zig features are **not used** in this codebase:

- No `union(enum)` (tagged unions)
- No `errdefer`
- No test blocks
- No `std.io` Reader/Writer (all I/O is register-level)
- No standard `std.mem.Allocator` (custom bump pool)
- No `usingnamespace` (removed in Zig 0.15)
