# Context-Sensitive Syntax

Rip uses a small set of tokens across several grammatical contexts.
This reference records the current readings that matter most for
colons, keys, members, and declarations. Invalid forms reject
positioned unless explicitly described as legal arithmetic.

## Class bodies

In a class body, a colon after a member name introduces a type slot.

| Syntax | Meaning |
|---|---|
| `x = 5` | value field |
| `x: number` | typed field declaration |
| `x: number = 5` | typed value field |
| `speak: -> @x` | method |
| `save!: -> …` | void method |
| `@version = "1"` | static field |
| `constructor: (@name) ->` | promoted constructor parameter |
| `class @Baby` | static nested class |
| `"data-src" = "v"` | string-named field |
| `"data-src": string = "v"` | typed string-named field |
| `@"app-name" = "rip"` | static string-named field |

`x: 5` is invalid because the value occupies a type slot. A bare
hyphenated declaration such as `data-src = "v"` parses as arithmetic
and is invalid as a field declaration; quote the name.

`::` is prototype access, not a type operator:

```rip
String::trim
```

Type annotations always use one colon.

## Object literals

In an object literal, a colon introduces the value slot.

```rip
{a: 1}
{a}
{...rest}
{data-src: 1}
{www.amazon.com: 4}
{"a-b": 1}
{"#{key}": value}
{[key]: value}
{fn: -> 1}
```

Compound dotted and hyphenated keys are flat string keys. Reads use
brackets:

```rip
config =
  api.host: 'example'
  favorite-port: 1023
  sites:
    beta.example.com: 'beta'

config['api.host']
config.sites['beta.example.com']
```

Spacing preserves neighboring expressions:

- `{k: a - b}` keeps subtraction.
- `condition ? left.member : right` keeps the ternary else colon.
- `value = :done` is a symbol literal.
- A regex key belongs in a map literal, not an object.

## Map literals

`*{ … }` creates a `Map`. Keys retain their types:

```rip
lookup = *{
  /pattern/: handler
  1: 'one'
  :ready: true
  ...other
}
```

Identifier keys still read as strings. A spaced `* {` remains
multiplication.

## Statement scope

At module and function statement level:

| Syntax | Meaning |
|---|---|
| `x = 5` | binding/assignment |
| `x: number` | typed forward declaration |
| `x: number = 5` | typed binding |
| `x: 5` | implicit object expression, not a declaration |

The legal `x: 5` reading can be a trap when its value is discarded.

`object.data-src = 5` is also legal arithmetic:
`object.data - (src = 5)`. Hyphenated member access always uses
brackets.

## Grammar islands

Two regions define their own local syntax:

- **Schema bodies** use field lines, kinds, directives, refinements,
  methods, and derived members owned by the schema sub-parser.
- **Render bodies** use elements, attributes, directives, component
  props, transitions, refs, and dynamic blocks owned by the render
  collector.

These regions still obey the compiler's normal mapping, control-flow,
and rejection rules.

## String-named members

Quoted member names are the universal declaration spelling for names
that are not JavaScript identifiers.

### Declaration

| Member | Plain | String-named |
|---|---|---|
| value | `count = 0` | `"data-src" = "d"` |
| typed | `count: number = 0` | `"data-src": string = "d"` |
| static | `@version = 1` | `@"app-name" = "rip"` |

### Inside methods

| Operation | Plain | String-named |
|---|---|---|
| read | `@count` | `@"data-src"` |
| write | `@count = 1` | `@"data-src" = value` |

The same `@` forms inside a static method address the class.

### Outside the class

```rip
widget.count
widget["data-src"]
Widget.version
Widget["app-name"]
```

Dot access is available only for legal identifiers. Bracket access
works for every property name.

## Render gates

A render gate binds a private component member to app data that the app
renderer loads before constructing the component:

```rip
Profile = component
  user <~ @app.data.user
  order <~ @app.data.order(params.id)

  form := { ...user }

  render
    h1 user.name
```

`<~` is legal only as a direct component body line. Its right-hand side is a
literal `@app.data` path, optionally addressed by one literal or `params` /
`query` path. Gates bind before ordinary member initializers, so `form` above
sees the prefetched non-null value.

Gated components are route-level components. They can only be constructed by
the `@rip-lang/app` renderer; direct construction and embedded-child use reject
loudly.

## Render naming

Inside `render`:

- PascalCase names identify child components.
- ALL_CAPS names are ordinary values.
- lowercase names identify DOM elements.
- `.class-name` consumes a tight hyphen as part of the class.
- attribute and component-prop pairs use `key: value`.
- boolean component props may use bare shorthand.

See the language batteries for the executable contract of every
accepted and rejected form.
