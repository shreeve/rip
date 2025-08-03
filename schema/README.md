<img src="/assets/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Schema - ActiveRecord-Inspired Database DSL

**Write Beautiful Database Schemas with Rails Elegance and Bun Performance**

## Why rip-schema?

- 🎯 **Familiar Syntax**: If you know ActiveRecord, you already know rip-schema
- 🔥 **Bun-First**: Built specifically for the Bun ecosystem
- 🛡️ **Type-Safe**: Full TypeScript support with Drizzle ORM under the hood
- ⚡ **Fast**: No runtime overhead - compiles to efficient Drizzle schemas
- 🎨 **Beautiful DSL**: Clean, readable schema definitions

## Quick Start

```coffeescript
# Define your schema with our elegant DSL
@schema ->
  @table 'users', ->
    @string   'name!', 100        # ! means required
    @email    'email!'            # Special email type
    @string   'password_digest!'
    @boolean  'active', true      # Default value
    @timestamps()                 # Adds created_at, updated_at

    @index    'email', unique: true  # Or use @index 'email!' (! = unique)
```

## Features

### Column Types

All your favorite column types with intuitive syntax:

```coffeescript
@table 'posts', ->
  # Basic types
  @string     'title!', 200           # Required string with max length
  @text       'content!'              # Required text (unlimited)
  @integer    'view_count', [0]       # Integer with default 0
  @bigint     'user_id!'              # Required bigint
  @boolean    'published', false      # Boolean with default
  @decimal    'price', 10, 2          # Decimal(10,2) - exact numeric
  @float      'rating'                # Float - standard precision, no size needed
  @double     'latitude'              # Double - double precision, no size needed
  @json       'metadata', {}          # JSON with default

  # Date/time types
  @date       'birth_date'
  @datetime   'published_at'
  @timestamp  'last_viewed_at'

  # Special types
  @uuid       'public_id'             # Auto-generates UUIDs
  @email      'contact_email'         # String with email semantics
  @binary     'file_data'             # Binary blob
```

### Relationships

Express relationships naturally:

```coffeescript
@table 'posts', ->
  @belongs_to 'user'              # Creates user_id! with index
  @belongs_to 'category', foreign_key: 'cat_id'
```

### Indexes

Flexible index definitions:

```coffeescript
@table 'posts', ->
  @index 'slug', unique: true
  @index ['user_id', 'published_at']
  @index 'published_at', where: 'published = 1'  # Partial index!
```

### Advanced Features

```coffeescript
# Table without auto-incrementing ID
@table 'settings', primary_key: 'key', id: false, ->
  @string 'key!', 100
  @text   'value'

# Soft deletes
@table 'comments', ->
  @soft_delete()    # Adds deleted_at column and index

# Check constraints
@table 'products', ->
  @decimal 'price!', 10, 2
  @check   'price > 0', 'positive_price'
```

## Real-World Example

```coffeescript
import { schema } from '@rip/schema'

export default schema ->

  # Users with all the goodies
  @table 'users', ->
    @string     'name!', 100
    @email      'email!'
    @string     'password_digest!'
    @boolean    'email_verified', false
    @datetime   'email_verified_at'
    @string     'avatar_url'
    @json       'preferences', {}
    @timestamps()

    @index      'email', unique: true
    @index      ['created_at', 'email_verified']

  # Posts with relationships
  @table 'posts', ->
    @belongs_to 'user'
    @string     'title!', 200
    @string     'slug!', 200
    @text       'content!'
    @text       'excerpt'
    @boolean    'published', false
    @datetime   'published_at'
    @integer    'view_count', [0]
    @json       'metadata'
    @timestamps()

    @index      'slug', unique: true
    @index      ['user_id', 'published', 'published_at']

  # Many-to-many join table
  @table 'post_tags', id: false, timestamps: false, ->
    @bigint     'post_id!'
    @bigint     'tag_id!'

    @index      ['post_id', 'tag_id'], unique: true
```

## Using with Drizzle

rip-schema generates standard Drizzle schemas:

```coffeescript
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import schema from './schema'

# Create database connection
sqlite = new Database('app.db')
db = drizzle(sqlite, { schema })

# Use Drizzle normally
users = await db.select().from(schema.users).all()
```

## Migrations (Coming Soon)

```coffeescript
migrate '20240101000000', 'add_avatar_to_users', ->
  @up ->
    @add_column 'users', 'avatar_url', 'string'

  @down ->
    @remove_column 'users', 'avatar_url'
```

## ActiveRecord Compatibility

rip-schema supports the schema patterns you know and love:

- ✅ `!` notation: required fields (`'name!'`) and unique indexes (`@index 'email!'`)
- ✅ Array notation for defaults: `[0]`, `[""]`
- ✅ Size hints: `string 'name', 50`
- ✅ Options hash for columns
- ✅ `belongs_to` relationships
- ✅ Named indexes
- ✅ Composite indexes
- ✅ Partial indexes
- ✅ Check constraints
- ✅ `timestamps()` helper
- ✅ `soft_delete()` helper
- ✅ JSON fields with object/array defaults

## Future Enhancements (TODO)

The following features are planned for future releases:

### 1. **Check Constraints with Range Syntax**
```coffee
@integer 'age', 18..120                    # Range syntax
@integer 'age', min: 18, max: 120          # Named parameters
@decimal 'rating', 0.0..5.0                # Works for decimals too
```

### 2. **Enum Support**
```coffee
@enum 'status', ['New', 'Active', 'Archived'], default: 'New'
# or
@integer 'status', values: {0: 'New', 1: 'Active', 2: 'Archived'}, default: 0
```

### 3. **Foreign Key Relationships**
```coffee
@references 'user'                         # Creates user_id automatically
@bigint 'user_id!', references: 'users.id', on_delete: 'cascade'
```

### 4. **Computed/Generated Columns**
```coffee
@string 'full_name', generated: "first_name || ' ' || last_name"
@integer 'age', generated: "date('now') - birthdate"
```

### 5. **Advanced Index Options**
```coffee
@index 'email', unique: true, where: 'deleted_at IS NULL'  # Partial index
@index 'name', using: 'gin'                                # Index type
@index 'description', include: ['status']                  # Covering index
```

### 6. **Column Collation**
```coffee
@string 'name', collate: 'NOCASE'          # Case-insensitive
@string 'title', collate: 'RTRIM'          # Ignore trailing spaces
```

### 7. **Triggers as Part of Schema**
```coffee
@trigger 'increment_views',
  after: 'update',
  when: 'NEW.viewed > OLD.viewed',
  do: 'UPDATE posts SET view_count = view_count + 1 WHERE id = NEW.id'
```

### 8. **Virtual Tables / Views**
```coffee
@view 'active_users', ->
  @from 'users'
  @where 'deleted_at IS NULL AND last_login > date("now", "-30 days")'
```

### 9. **Polymorphic Associations**
```coffee
@polymorphic 'attachable'                  # Creates attachable_id and attachable_type
```

### 10. **Migration CLI Commands**
```coffee
rip-schema db:migrate                      # Run pending migrations
rip-schema db:rollback                     # Rollback last migration
rip-schema generate:migration AddUserEmail # Generate migration file
```

## Installation

```bash
bun add @rip/schema
```

## Requirements

- Bun 1.0+
- TypeScript 5.0+
- Drizzle ORM 0.29+

## License

MIT

## Contributing

rip-schema is part of the Rip ecosystem. Contributions welcome!

---

Built with ❤️ for the Bun community