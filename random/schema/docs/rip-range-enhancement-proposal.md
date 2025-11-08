<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Language Enhancement: First-Class Open-Ended Ranges

## Executive Summary

Extend Rip/CoffeeScript to support open-ended ranges as first-class values, enabling elegant DSL syntax for constraints and boundaries.

## Current State

Open-ended ranges work in **slicing contexts**:
```coffee
arr[5..]    # ✅ Works: from index 5 to end
arr[..20]   # ✅ Works: from start to index 20
arr[..]     # ✅ Works: entire array
```

But NOT as **standalone values**:
```coffee
minAge = 18..     # ❌ SyntaxError
maxLength = ..100 # ❌ SyntaxError
```

## Proposed Enhancement

Make ranges first-class values that can be:
- Assigned to variables
- Passed as arguments
- Returned from functions
- Used in DSLs

## Grammar Changes

In `grammar.coffee`, extend the `Range` rule:

```diff
  Range: [
    o '[ Expression RangeDots Expression ]',      -> new Range $2, $4, if $3.exclusive then 'exclusive' else 'inclusive'
    o '[ ExpressionLine RangeDots Expression ]',  -> new Range $2, $4, if $3.exclusive then 'exclusive' else 'inclusive'
+   o 'Expression RangeDots',                     -> new Range $1, null, if $2.exclusive then 'exclusive' else 'inclusive'
+   o 'RangeDots Expression',                     -> new Range null, $2, if $1.exclusive then 'exclusive' else 'inclusive'
+   o 'RangeDots',                                -> new Range null, null, if $1.exclusive then 'exclusive' else 'inclusive'
  ]
```

## Use Cases

### 1. Schema Definitions (rip-schema)
```coffee
@model 'User', ->
  @string  'username', 3..20    # 3 to 20 chars
  @string  'bio', ..5000        # up to 5000 chars
  @integer 'age', 18..          # 18 or older
  @decimal 'price', 0.01..      # at least $0.01
```

### 2. Validation Functions
```coffee
validateAge = (age, range = 0..120) ->
  age in range

validateLength = (str, range = 1..) ->
  str.length in range
```

### 3. Configuration
```coffee
config =
  port: 3000..9999
  workers: 1..
  timeout: ..30000
  retries: ..5
```

### 4. Pattern Matching (Future)
```coffee
switch score
  when 90..    then 'A'
  when 80..89  then 'B'
  when 70..79  then 'C'
  when ..69    then 'F'
```

## Implementation Details

### Range Object Representation
```coffee
# Current (arrays only)
[1..10]  # -> [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# Proposed (range objects)
1..10    # -> Range { from: 1, to: 10, exclusive: false }
5..      # -> Range { from: 5, to: null, exclusive: false }
..20     # -> Range { from: null, to: 20, exclusive: false }
..       # -> Range { from: null, to: null, exclusive: false }
```

### Runtime Behavior
```javascript
// Generated JavaScript
new Range(1, 10)      // 1..10
new Range(5, null)    // 5..
new Range(null, 20)   // ..20
new Range(null, null) // ..
```

## Benefits

1. **Natural Syntax** - `18..` reads as "18 or more"
2. **Consistent** - Aligns with Ruby, Rust, and other modern languages
3. **Powerful** - Enables elegant DSLs
4. **Backward Compatible** - Existing array slicing still works
5. **Type-Safe** - Can be properly typed in TypeScript

## Migration Path

1. **Phase 1**: Add grammar support (non-breaking)
2. **Phase 2**: Update Range class for standalone use
3. **Phase 3**: Add helper methods (`.includes()`, `.toArray()`)
4. **Phase 4**: Integrate with rip-schema

## Example Implementation

```coffee
# In your DSL
parseConstraint = (constraint) ->
  if constraint instanceof Range
    min: constraint.from
    max: constraint.to
  else if Array.isArray(constraint) and constraint.length == 2
    min: constraint[0]
    max: constraint[1]
  else
    constraint

# Usage becomes elegant
@integer 'age', 18..     # Range object
@integer 'age', [18, null]  # Still works
```

## Next Steps

1. Implement grammar changes in `rip-parser`
2. Test thoroughly with edge cases
3. Update documentation
4. Release as Rip enhancement

This positions Rip as a modern, DSL-friendly language!