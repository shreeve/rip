<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Range Syntax - Final Design

After testing CoffeeScript's capabilities, here are our best options for clean range syntax:

## Option 1: Array Notation (Recommended)

Use 2-element arrays where `null` means "unbounded":

```coffeescript
@model 'User', ->
  @string  'name!', [3, 50]        # 3 to 50 chars
  @string  'bio', [null, 5000]     # up to 5000 chars
  @integer 'age', [18, 120]        # 18 to 120
  @integer 'score', [0, null]      # 0 or more
  @decimal 'price', [0.01, 9999]   # 0.01 to 9999
```

**Pros:**
- Clean, minimal syntax
- Works with CoffeeScript as-is
- Easy to implement
- Visually distinct from other parameters

**Implementation:**
```coffeescript
# In parseParams
if Array.isArray(arg) and arg.length == 2
  options.min = arg[0] if arg[0]?
  options.max = arg[1] if arg[1]?
```

## Option 2: String Range Notation

Use strings with `..` for a more Ruby-like feel:

```coffeescript
@model 'User', ->
  @string  'name!', '3..50'      # 3 to 50 chars
  @string  'bio', '..5000'       # up to 5000 chars
  @integer 'age', '18..120'      # 18 to 120
  @integer 'score', '0..'        # 0 or more
  @decimal 'price', '0.01..9999' # 0.01 to 9999
```

**Pros:**
- Looks like Ruby ranges
- Supports open-ended ranges naturally
- Very readable

**Cons:**
- Strings need parsing
- Less type-safe

## Option 3: Helper Functions

Provide range builder functions:

```coffeescript
@model 'User', ->
  @string  'name!', between(3, 50)
  @string  'bio', max(5000)
  @integer 'age', between(18, 120)
  @integer 'score', min(0)
  @decimal 'price', between(0.01, 9999)
```

**Pros:**
- Self-documenting
- Type-safe
- Flexible

**Cons:**
- More verbose
- Need to import helpers

## Comparison with Zod

Our cleanest syntax (arrays):
```coffeescript
@string  'username', [3, 20], pattern: /^[a-z0-9_]+$/
@integer 'age', [13, 120]
@array   'tags', [1, 10]
```

Versus Zod's chains:
```typescript
z.string().min(3).max(20).regex(/^[a-z0-9_]+$/)
z.number().int().min(13).max(120)
z.array(z.string()).min(1).max(10)
```

## Final Recommendation

Use **Array Notation** as the primary syntax because:

1. **It's the cleanest** - `[3, 50]` is clearer than any alternative
2. **No magic** - Just plain arrays, no special parsing
3. **Consistent** - Works the same for all types
4. **Flexible** - `[3, null]`, `[null, 50]`, `[3, 50]` all work
5. **CoffeeScript native** - No hacks or workarounds

## Examples with Array Notation

```coffeescript
@model 'Product', ->
  # String constraints
  @string  'sku!', [8, 12]         # 8-12 chars
  @string  'name!', [1, 200]       # 1-200 chars
  @text    'description', [null, 5000]  # up to 5000

  # Numeric constraints
  @decimal 'price!', [0.01, 99999.99]
  @integer 'stock', [0, null]      # non-negative
  @integer 'min_order', [1, 1000]

  # Array constraints
  @array   'images', [1, 10]       # 1-10 images
  @array   'tags', [null, 50]      # up to 50 tags

@model 'User', ->
  @string  'username!', [3, 20], pattern: /^[a-z0-9_]+$/
  @string  'password!', [8, null], pattern: /(?=.*[A-Z])(?=.*[0-9])/
  @integer 'age', [13, 120]
  @email   'email!', [null, 255]

@model 'ApiLimit', ->
  @integer 'requests_per_hour', [1, 10000]
  @integer 'burst_size', [1, 100]
  @decimal 'cost_per_request', [0.0001, 1.0]
```

This gives us 90% of the cleanliness with 100% compatibility!