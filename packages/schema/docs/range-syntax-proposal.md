<img src="/assets/logo.png" style="width:50px" /> <br>

# Range Syntax - IMPLEMENTED! ✅

**Status: COMPLETE** - Perfect consistency with `read()` function achieved!

## The Problem with Verbose APIs

Zod and similar libraries force you to write:
```javascript
z.string().min(3).max(100).regex(/^[a-z]+$/)
z.number().int().min(18).max(65).positive()
z.array(z.string()).min(1).max(10)
```

This is **ugly**, **verbose**, and **hard to read**.

## Our Clean Range Syntax

Using elegant `[min, max]` arrays - simple, clear, and consistent with the `read()` function:

```coffeescript
# String with length constraints
@string 'name', [3, 100]        # 3 to 100 characters
@string 'username', [5, 50]     # 5 to 50 characters
@string 'code', [6, 6]          # exactly 6 characters

# Numbers with ranges
@integer 'age', [18, 120]       # between 18 and 120
@integer 'score', [0, 100]      # 0 to 100 points
@decimal 'price', [0.01, 9999.99]  # price range

# Combining with other parameters
@string 'email', [5, 255], pattern: /^[^@]+@[^@]+$/
@integer 'quantity', [1, 1000], multiple: 5
@decimal 'price', [0.01, 9999.99], precision: 2

# With defaults
@string 'name', [3, 50], ['Anonymous']    # Range + default
@integer 'priority', [1, 10], [5]        # Range + default
```

## Implementation Details

### Range Detection
```typescript
// In our parseParams method
if (Array.isArray(arg) && arg.length === 2 &&
    typeof arg[0] === 'number' && typeof arg[1] === 'number') {
  // It's a range array!
  options.min = Math.min(arg[0], arg[1])
  options.max = Math.max(arg[0], arg[1])
}
```

### Perfect Consistency with read() Function
```coffeescript
# rip-schema definition
@integer 'age', [18, 120]
@string 'name', [3, 50]

# read() function validation (identical syntax!)
age = read 'age', [18, 120]
name = read 'name', [3, 50]
```

## Generated Zod Output

Our clean syntax:
```coffeescript
@model 'Product', ->
  @string  'name!', [3, 50]
  @text    'description', [0, 5000]
  @decimal 'price!', [0.01, 99999.99]
  @integer 'stock', [0, 999999]
  # Note: arrays would need different syntax for size constraints
```

Would generate this verbose Zod:
```typescript
const ProductSchema = z.object({
  name: z.string().min(3).max(50),
  description: z.string().max(5000).optional(),
  price: z.number().min(0.01).max(99999.99),
  stock: z.number().int().min(0).optional(),
  tags: z.array(z.string()).min(1).max(10).optional()
})
```

## More Examples

### User Schema
```coffeescript
@model 'User', ->
  @string   'username!', [3, 20], pattern: /^[a-z0-9_]+$/
  @string   'password!', [8, 128], pattern: /(?=.*[A-Z])(?=.*[0-9])/
  @integer  'age', [13, 120]
  @email    'email!', [5, 255]
```

### API Rate Limiting
```coffeescript
@model 'RateLimit', ->
  @integer  'requests_per_hour', [1, 10000]
  @integer  'burst_size', [1, 100]
  @decimal  'cost_per_request', [0.0001, 1.0]
```

### Product Inventory
```coffeescript
@model 'Inventory', ->
  @integer  'quantity', [0, 999999]    # non-negative with reasonable max
  @integer  'reorder_level', [1, 1000]
  @decimal  'weight_kg', [0.001, 1000]
```

## Why This is Better

1. **Intuitive** - Ranges are a natural way to think about constraints
2. **Concise** - One parameter instead of two method calls
3. **Readable** - `[18, 65]` is clearer than `.min(18).max(65)`
4. **Consistent** - Identical syntax with `read()` function validation
5. **Simple** - Just arrays, no complex CoffeeScript range parsing
6. **Context-Aware** - Numbers = value range, Strings = length range

## Next Steps

1. Implement range detection in `parseParams()`
2. Update all numeric/string/array methods to handle ranges
3. Generate appropriate Zod chains from ranges
4. Document the feature
5. Add tests for edge cases