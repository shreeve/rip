# Rip Syntax Reference

## Principles

- Indentation-sensitive, no semicolons, no braces
- Expressions and routines produce values when those values are used
- Obvious intent should not require extra boilerplate
- Types are optional in source, required by code generation
- Rip says less, Zig gets the right thing

## Conditionals

One keyword — `if` — works in both prefix and postfix position. The parser distinguishes them automatically by grammar context.

```text
# Prefix: block form (multi-line)
if x > 0
  print x
else
  print 0

# Prefix: else-if chain
if x > 100
  print "big"
else if x > 0
  print "small"
else
  print "zero"

# Prefix: optional unwrap with capture
if user as val
  process val

# Prefix: pipe capture (synonym for `as`)
if user |val|
  process val

# Postfix: inline guard
print x if x > 0
return if done

# Postfix: conditional value
label = "big" if x > 100 else "small"
```

## Routines

`fun` yields a value (last expression returned implicitly). `sub` is for effects (returns void).

```text
fun add a: i32, b: i32 -> i32
  a + b

sub greet name: []u8
  print name
```

Types are optional — untyped params default to `i64`, untyped `fun` returns `i64`.

```text
fun square x
  x * x
```

## Bindings

`=` for normal bindings, `=!` for constants. No `let` or `const` keywords.

```text
total = add 1, 2
limit =! 100
```

The compiler infers `var` vs `const` from usage — if a name is reassigned later, it gets `var`; otherwise `const`.

## Compound Assignment

```text
x += 1
x -= 1
x *= 2
x /= 4
```

## Loops

```text
# While loop
while count < 10
  count += 1

# While with continue expression
while i < n : i += 1
  process i

# For over range
for i in 0..10
  print i

# For over slice
for item in items
  print item

# For with index
for item, i in items
  print i

# For with pointer capture (mutation)
for *item in items
  item.* += 1
```

`break` and `continue` work as expected.

## Match

```text
# Single-line arms
match color
  0 => print "red"
  1 => print "green"
  _ => print "other"

# Block arms
match value
  0 => print "zero"
  1
    print "one"
    doMore()
  _ => print "other"

# Range patterns
match code
  0..31 => print "control"
  32..126 => print "printable"
  _ => print "extended"

# Enum patterns
match color
  .red => print "red"
  .green => print "green"
  _ => print "other"
```

## Declarations

```text
# Enum
enum Color
  red
  green
  blue

# Struct with typed fields
struct Point
  x: f64
  y: f64

# Struct with methods
struct Point
  x: f64
  y: f64

  fun sum self: Point -> f64
    self.x + self.y

# Error set
error FileError
  NotFound
  PermissionDenied

# Type definition
type Num = i64

# Visibility
pub fun double x: i32 -> i32
  x * 2
```

## Calls

```text
# Implicit (no parens)
add 1, 2
print total

# Explicit parens
add(1, 2)
square(7)

# Dot access
point.x
items.len

# Pointer deref
ptr.*
ptr.*.field

# Index access
items[0]
matrix[i]

# Await
fetch! url
```

## Operators

Arithmetic: `+`, `-`, `*`, `/`, `%`, `**`
Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
Logical: `&&`, `||`, `!`
Null coalescing: `??` (lowers to Zig `orelse`)
Error handling: `catch`, `catch as err`
Pipe: `|>`
Range: `..`
Unary: `-x`, `!x`, `try expr`

## Type Annotations

Types are optional on parameters and return values.

```text
fun add a: i32, b: i32 -> i32    # fully typed
fun square x                      # untyped (defaults to i64)
```

Type references support modifiers:

```text
name: ?i32       # optional
name: *Point     # pointer
name: []u8       # slice
name: !void      # error union
```

## Other

```text
# Defer and errdefer
defer cleanup()
errdefer handle_error()

# Comptime
comptime expr

# Unreachable and undefined
unreachable
undefined

# @builtins
@import("std")
@intCast(x)

# Array literal
nums = [1, 2, 3]

# Struct literal
p = Point { x: 1.0, y: 2.0 }

# Lambda
fn x, y
  x + y

# Discard
_ = unused_result()

# Test block
test "description"
  body

# Use (capability/import)
use std
```
