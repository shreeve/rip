<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Range Syntax Proposal for Rip Schema

## The Problem with Verbose APIs

Zod and similar libraries force you to write:
```javascript
z.string().min(3).max(100).regex(/^[a-z]+$/)
z.number().int().min(18).max(65).positive()
z.array(z.string()).min(1).max(10)
```

This is **ugly**, **verbose**, and **hard to read**.

## Our Clean Range Syntax

Using CoffeeScript's range operator `..` and our type-based parameter detection:

```coffeescript
# String with length constraints
@string 'name', 3..100          # 3 to 100 characters
@string 'username', 5..         # at least 5 characters
@string 'code', ..10            # up to 10 characters

# Numbers with ranges
@integer 'age', 18..120         # between 18 and 120
@integer 'score', 0..           # non-negative (0 or more)
@integer 'temperature', ..-273  # up to -273 (absolute zero)

# Arrays with size constraints
@array 'tags', 1..5             # 1 to 5 tags
@array 'items', 1..             # at least 1 item (non-empty)
@array 'options', ..10          # up to 10 items

# Combining with other parameters
@string 'email', 5..255, pattern: /^[^@]+@[^@]+$/
@integer 'quantity', 1..1000, multiple: 5
@decimal 'price', 0.01..9999.99, precision: 2
```

## Implementation Details

### Range Detection
```coffeescript
# In our parseParams method
if typeof arg is 'object' and arg.constructor?.name is 'Range'
  # It's a range!
  options.min = arg.start if arg.start?
  options.max = arg.end if arg.end?
```

### CoffeeScript Range Syntax
```coffeescript
# Inclusive ranges
1..10    # { start: 1, end: 10 }
5..      # { start: 5, end: undefined }
..20     # { start: undefined, end: 20 }

# Exclusive ranges (we probably don't need these)
1...10   # { start: 1, end: 9 }
```

## Generated Zod Output

Our clean syntax:
```coffeescript
@model 'Product', ->
  @string  'name!', 3..50
  @text    'description', ..5000
  @decimal 'price!', 0.01..99999.99
  @integer 'stock', 0..
  @array   'tags', 1..10
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
  @string   'username!', 3..20, pattern: /^[a-z0-9_]+$/
  @string   'password!', 8.., pattern: /(?=.*[A-Z])(?=.*[0-9])/
  @integer  'age', 13..120
  @email    'email!', ..255
  @array    'interests', ..50
```

### API Rate Limiting
```coffeescript
@model 'RateLimit', ->
  @integer  'requests_per_hour', 1..10000
  @integer  'burst_size', 1..100
  @decimal  'cost_per_request', 0.0001..1.0
  @array    'allowed_endpoints', 1..
```

### Product Inventory
```coffeescript
@model 'Inventory', ->
  @integer  'quantity', 0..         # non-negative
  @integer  'reorder_level', 1..
  @decimal  'weight_kg', 0.001..1000
  @array    'locations', 1..20
```

## Why This is Better

1. **Intuitive** - Ranges are a natural way to think about constraints
2. **Concise** - One parameter instead of two method calls
3. **Readable** - `18..65` is clearer than `.min(18).max(65)`
4. **Flexible** - Open-ended ranges with `..` syntax
5. **CoffeeScript Native** - Uses the language's built-in range operator

## Next Steps

1. Implement range detection in `parseParams()`
2. Update all numeric/string/array methods to handle ranges
3. Generate appropriate Zod chains from ranges
4. Document the feature
5. Add tests for edge cases