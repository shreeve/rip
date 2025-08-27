<img src="/assets/logo.png" style="width:50px" /> <br>

# Open-Ended Range Enhancement for Rip

## Discovery

The CoffeeScript grammar ALREADY supports open-ended ranges in slicing contexts!

```coffee
# From grammar.coffee lines 608-612:
o 'Expression RangeDots',        -> new Range $1, null   # 5..
o 'RangeDots Expression',        -> new Range null, $2   # ..20
o 'RangeDots',                   -> new Range null, null # ..
```

This means we can potentially enable:
- `5..` - from 5 to infinity
- `..20` - from negative infinity to 20
- `..` - all values

## Current Limitation

These work in array slicing:
```coffee
arr[5..]    # from index 5 to end
arr[..20]   # from start to index 20
arr[..]     # entire array
```

But NOT as standalone expressions:
```coffee
range = 5..   # SyntaxError!
```

## Proposed Enhancement

Add open-ended ranges as first-class values by updating the `Range` rule:

```coffee
Range: [
  o '[ Expression RangeDots Expression ]',     # [1..10]
  o '[ Expression RangeDots ]',                # [5..]  NEW!
  o '[ RangeDots Expression ]',                # [..20] NEW!
  o '[ RangeDots ]',                           # [..]   NEW!
]
```

## Use Cases for rip-schema

This would enable our dream syntax:

```coffeescript
@model 'User', ->
  @string  'name!', 3..50      # 3 to 50
  @string  'bio', ..5000       # up to 5000
  @integer 'age', 18..         # 18 or more
  @decimal 'price', 0.01..     # at least 0.01
```

## Implementation Plan

1. **Update grammar.coffee** - Add new Range productions
2. **Update nodes.coffee** - Handle Range with null start/end
3. **Update lexer.coffee** - Ensure proper tokenization
4. **Test thoroughly** - Edge cases and interactions

## Benefits

1. **Natural syntax** - `18..` reads as "18 or more"
2. **Consistent** - Works like Ruby/Rust ranges
3. **Backward compatible** - Existing code still works
4. **Powerful** - First-class range values

## Example Grammar Change

```diff
  Range: [
    o '[ Expression RangeDots Expression ]',      -> new Range $2, $4
+   o '[ Expression RangeDots ]',                 -> new Range $2, null
+   o '[ RangeDots Expression ]',                 -> new Range null, $3
+   o '[ RangeDots ]',                            -> new Range null, null
  ]
```

This is a significant improvement for DSLs in Rip.