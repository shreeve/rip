<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Schema - ActiveRecord-Inspired Database DSL

**Beautiful database schemas with Rails elegance and Bun performance**

## Quick Start

```coffeescript
import { schema as Schema } from '@rip/schema'

export default Schema ->
  @table 'users', ->
    @string   'name!', 100        # ! means required
    @email    'email!'            # Built-in email type
    @boolean  'active', true      # Default value
    @timestamps()                 # created_at, updated_at

    @index    'email', unique: true
```

```bash
# Install
bun add @rip/schema

# Create database from schema
rip-schema db:push
```

## Column Types

```coffeescript
# Text types
@string   'name!', 100        # Required, max length
@text     'bio'               # Unlimited text
@email    'email!'            # Email validation

# Numeric types
@integer  'age', [18]         # With default
@bigint   'user_id!'          # Large integers
@float    'rating'            # Single precision
@double   'latitude'          # Double precision
@decimal  'price', 10, 2      # Exact decimal(10,2)

# Date/Time
@date      'birth_date'
@time      'start_time'
@datetime  'published_at'
@timestamp 'last_seen'

# Other types
@boolean  'active', false     # With default
@json     'settings', {}      # JSON data
@binary   'avatar'            # Binary data
@uuid     'public_id'         # UUID v4
```

## Flexible Parameters

```coffeescript
# Type-based parameters (can be in any order)
@string   'name', 100         # Size as number
@integer  'age', [18]         # Default as array
@decimal  'price', 10, 2      # Precision and scale

# Named parameters (must come last)
@integer  'status', default: 0, unsigned: true
@binary   'data', size: 'long'
@string   'code', size: 10, default: 'ABC'
```

## Special Features

```coffeescript
# Required fields and unique indexes
@string   'email!'            # ! suffix = required
@index    'email!'            # ! suffix = unique

# Timestamps helper
@timestamps()                 # Adds created_at, updated_at

# Table options
@table 'posts', id: false, timestamps: false, ->
  @bigint 'custom_id!'

# Custom primary key
@table 'accounts', primary_key: 'account_num', ->
  @string 'account_num!', 20
```

## CLI Commands

```bash
# Push schema to database (default: ./db/schema.rip → ./db.db)
rip-schema db:push

# Generate Zod validation schemas
rip-schema zod:generate

# Save generated schemas to file
rip-schema zod:generate > types/schemas.ts

# Custom paths
rip-schema db:push -s myschema.rip -d mydb.db

# Drop all tables
rip-schema db:drop

# Verbose output
rip-schema db:push -v
```

## 🎯 Zod Generation - Single Source of Truth

**Generate type-safe Zod validation schemas directly from your database schema!**

### The Complete Workflow

```bash
# 1. Define your schema once
vim db/schema.rip

# 2. Push to database
rip-schema db:push

# 3. Generate validation schemas
rip-schema zod:generate > types/schemas.ts

# 4. Use in your API with full type safety!
```

### From Schema to Validation

**Input** (`db/schema.rip`):
```coffeescript
export default schema ->
  @table 'users', ->
    @integer  'id!', primary: true, autoIncrement: true
    @email    'email!', unique: true
    @string   'firstName!', 100
    @string   'lastName!', 100
    @string   'phone!', 20
    @boolean  'admin', false
    @json     'preferences'
    @timestamps()
```

**Generated Output** (`types/schemas.ts`):
```typescript
import { z } from 'zod'

export const UserSchema = z.object({
  id: z.number().int(),
  email: z.string().email(),
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  phone: z.string().max(20),
  admin: z.boolean().default(false),
  preferences: z.record(z.unknown()).optional()
})

export type User = z.infer<typeof UserSchema>
```

### Use in Your API

```coffeescript
# Import generated schemas
import { UserSchema } from './types/schemas'
import { zValidator } from '@hono/zod-validator'

# Type-safe API endpoints
app.post '/users', zValidator('json', UserSchema.pick({
  email: true
  firstName: true
  lastName: true
  phone: true
})), (c) ->
  data = c.req.valid 'json'  # Fully validated & typed!

  user = db.insert(users).values(data).returning().get!
  c.json { user }

# Partial updates
app.patch '/users/:id', zValidator('json', UserSchema.partial().pick({
  firstName: true
  lastName: true
  preferences: true
})), (c) ->
  data = c.req.valid 'json'  # Type-safe partial updates!
```

### Benefits

- ✅ **Single Source of Truth** - One schema for database + validation
- ✅ **Type Safety** - Generated TypeScript types with `z.infer`
- ✅ **Auto-Completion** - Full IDE support for all fields
- ✅ **Validation** - Request/response validation with Zod
- ✅ **Consistency** - Database structure matches API contracts

## Real Example

```coffeescript
import { schema as Schema } from '@rip/schema'

export default Schema ->

  @table 'users', ->
    @string   'name!', 100
    @email    'email!'
    @string   'password_digest!'
    @boolean  'active', true
    @json     'preferences', {}
    @timestamps()

    @index    'email', unique: true

  @table 'posts', ->
    @bigint   'user_id!'
    @string   'title!', 200
    @string   'slug!', 200
    @text     'content!'
    @boolean  'published', false
    @datetime 'published_at'
    @timestamps()

    @index    'slug', unique: true
    @index    ['user_id', 'published']

  @table 'comments', ->
    @bigint   'post_id!'
    @bigint   'user_id!'
    @text     'content!'
    @boolean  'approved', false
    @timestamps()

    @index    'post_id'
```

## Documentation

- 📋 [**Development Status**](./docs/status.md) - Current status, roadmap, and timeline
- 📝 [**Changelog**](./CHANGELOG.md) - Version history and release notes
- 🚀 [**Examples**](../../examples/) - Real-world usage patterns

## ✅ Latest Features

**🎉 Zod Validation Generation** - Now available! Generate type-safe Zod schemas directly from your database schema with `rip-schema zod:generate`. Complete single-source-of-truth workflow from schema → database → API validation.

## License

MIT

## Contributing

Rip Schema is part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community