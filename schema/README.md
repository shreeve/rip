<img src="/assets/rip-icon-512wa.png" style="width:50px" /> <br>

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

# Custom paths
rip-schema db:push -s myschema.rip -d mydb.db

# Drop all tables
rip-schema db:drop

# Verbose output
rip-schema db:push -v
```

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

## Future Enhancements (TODO)

1. **Check Constraints** - `@check 'age >= 18'`
2. **Enums** - `@enum 'status', ['draft', 'published']`
3. **Foreign Keys** - `@references 'users'`
4. **Generated Columns** - `generated: "price * quantity"`
5. **Advanced Indexes** - Partial, covering indexes
6. **Collation** - `collate: 'NOCASE'`
7. **Triggers** - `@trigger 'update_total'`
8. **Views** - `@view 'active_users'`
9. **Polymorphic Relations** - `@polymorphic 'taggable'`
10. **Migration CLI** - `db:migrate`, `db:rollback`

## License

MIT

## Contributing

Rip Schema is part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community