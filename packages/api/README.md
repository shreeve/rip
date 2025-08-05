# @rip/api - Elegant API Development Toolkit

> **Transform complex API development into pure poetry with Rip's legendary validation patterns**

## 🎯 Purpose & Vision

`@rip/api` is the **API development toolkit** for the Rip language ecosystem. It provides elegant, battle-tested utilities that transform verbose, error-prone API development into clean, readable, and maintainable code.

**Core Philosophy**: API development should be **intuitive, safe, and beautiful**. Every function in this toolkit eliminates boilerplate, prevents common errors, and makes your intent crystal clear.

## 🏗️ Package Architecture

```
@rip/api/
├── helpers.rip        # Request validation & parsing (the star of the show)
├── middleware.rip     # Common middleware patterns (planned)
├── responses.rip      # Structured response helpers (planned)
└── validation.rip     # Advanced validation utilities (planned)
```

**Design Principles**:
- **Zero Configuration** - Works out of the box with sensible defaults
- **Framework Agnostic** - Built for Hono but adaptable to any framework
- **Type Safe** - Leverages Rip's elegant syntax for bulletproof validation
- **Performance First** - Optimized patterns that scale to production

## 🌟 Why @rip/api Exists

### The API Development Problem

Building robust APIs traditionally requires handling:
- **Request parsing** (JSON, form data, query params)
- **Input validation** (types, formats, required fields)
- **Data transformation** (cleaning, formatting, normalization)
- **Error handling** (validation failures, missing fields)
- **Type safety** (preventing runtime errors)

This leads to **verbose, repetitive code**:

```javascript
// Traditional JavaScript API validation - VERBOSE & ERROR-PRONE
app.post('/signup', async (req, res) => {
  try {
    const body = await req.json();

    // Email validation
    const emailMatch = body.email?.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/);
    const email = emailMatch ? emailMatch[0].toLowerCase() : null;
    if (!email) throw new Error('Invalid email');

    // Phone validation
    const phoneDigits = body.phone?.replace(/\D/g, '') || '';
    let phone = null;
    if (phoneDigits.length === 10) {
      const phoneMatch = phoneDigits.match(/^(\d{3})(\d{3})(\d{4})$/);
      phone = phoneMatch ? `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}` : null;
    }

    // State validation
    const stateMatch = body.state?.match(/^([a-z]{2})$/i);
    const state = stateMatch ? stateMatch[1].toUpperCase() : null;
    if (!state) throw new Error('Invalid state');

    // ... 50+ more lines of similar validation

  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
```

### The @rip/api Solution

**Transform 50+ lines into 5 elegant lines**:

```rip
# Rip API validation - PURE POETRY (Sinatra-style!)
import { read, c, withHelpers } from '@rip/api'

app.use withHelpers  # Enable context-free everything!

# OPTION 1: Traditional (context parameter)
app.post '/signup', (ctx) ->
  email = read! 'email', 'email!'     # First call async (parses request body)
  ctx.json { success: true, email }

# OPTION 2: Pure Sinatra-style (NO context parameter!)  
app.post '/signup', ->
  email = read! 'email', 'email!'     # First call async (parses request body)
  phone = read 'phone', 'phone'      # Subsequent calls sync (cached data)
  c().json { success: true, email, phone }  # c() gets global context
```

## 🔥 The `helpers.rip` Powerhouse

The crown jewel of `@rip/api` is the **`read()` function** - a validation and parsing powerhouse that eliminates 90% of API boilerplate.

### Why helpers.rip is Revolutionary

**1. Request Parsing Made Trivial**
- **Unified Interface**: One function handles JSON, form data, query params
- **Smart Caching**: Parses request once, reuses throughout handler
- **Error Resilient**: Graceful fallbacks for malformed data
- **Type Coercion**: Intelligent conversion between data types

**2. Legendary Regex Validation**
- **36 Built-in Validators**: From emails to credit cards to UUIDs
- **Rip's `=~` Operator**: Most elegant regex syntax ever created
- **Two Validation Patterns**: Semicolon for complex, postfix-if for simple
- **75% Less Code**: Compared to traditional JavaScript validation

**3. Mental Clarity & Developer Productivity**
- **Self-Documenting**: `read(c, 'email', 'email!')` tells the complete story
- **Required Fields**: The `!` suffix makes requirements crystal clear
- **Fallback Support**: Built-in handling for missing or invalid data
- **Zero Boilerplate**: No more manual parsing, validation, or error handling

### Core API: The `read()` Function

**Three calling styles supported**:

```rip
# Pure Sinatra-style (context-free everything) - ULTIMATE ELEGANCE
import { read, c } from '@rip/api'
app.post '/endpoint', ->
  data = read! 'key', 'validator'
  c().json { data }

# Traditional with context-free read calls - RECOMMENDED
app.post '/endpoint', (ctx) ->
  data = read! 'key', 'validator'  # No context in read!
  ctx.json { data }

# Explicit context (backward compatible)
read(context, key, validator, fallback)
```

**Parameters**:
- **`key`**: Field name to extract (or `null` for entire payload)
- **`validator`**: Validation/transformation rule
- **`fallback`**: Value to use if validation fails (optional)
- **`context`**: Hono request context (only needed without withHelpers)

**Global Context Access**:
- **`c()`**: Returns current request context (like Sinatra's `request`)
- **`env()`**: Alias for `c()` for those who prefer `env`

### Basic Usage Examples

```rip
import { read, c, withHelpers } from '@rip/api'

app.use withHelpers  # Enable Sinatra-style context-free calls

# STYLE 1: Traditional with context parameter
app.post '/api/users', (ctx) ->
  name = read! 'name'              # First call async (parses request body)
  email = read 'email', 'email!'  # Subsequent calls sync (cached data)
  ctx.json { name, email }

# STYLE 2: Pure Sinatra-style - NO context parameter!
app.post '/api/users', ->
  name = read! 'name'              # First call async (parses request body)
  email = read 'email', 'email!'  # Subsequent calls sync (cached data)
  role = read 'role', ['admin', 'user'], 'user'  # Sync (cached data)
  phone = read 'phone', 'phone'   # Sync (cached data)
  
  # Access context when needed
  c().json { name, email, role, phone }
```

### 🔄 **Sync vs Async: Smart Caching Explained**

**Why async?** The `read()` function parses the request body once per request (async), then caches the result.

**Pattern**:
- **First call**: `read! 'key', ...` - Async (parses request body, caches data)
- **Subsequent calls**: `read 'key', ...` - Sync (uses cached data)

**In Practice**: You can use `read!` everywhere for simplicity - if data is cached, it returns immediately!

### The 36 Built-in Validators

`helpers.rip` includes validators for every common API need:

#### **Basic Types**
```rip
id = read! 'user_id', 'id!'        # First call async (parses request body)
count = read 'count', 'whole'      # Subsequent calls sync (cached data)
price = read 'price', 'decimal'    # Sync (cached data)
cost = read 'cost', 'money'        # Sync (cached data)
```

#### **Text Processing**
```rip
title = read! 'title', 'string'    # First call async (parses request body)
bio = read 'bio', 'text'           # Subsequent calls sync (cached data)
full_name = read 'name', 'name'    # Sync (cached data)
```

#### **Contact Information**  
```rip
email = read! 'email', 'email'     # First call async (parses request body)
phone = read 'phone', 'phone'      # Sync (cached data)
address = read 'address', 'address' # Sync (cached data)
```

#### **Geographic Data**
```rip
state = read! 'state', 'state'     # First call async (parses request body)
zip = read 'zip', 'zip'            # Sync (cached data)
zipplus4 = read 'zip', 'zipplus4'  # Sync (cached data)
```

#### **Identity & Security**
```rip
ssn = read! 'ssn', 'ssn'           # First call async (parses request body)
sex = read 'gender', 'sex'         # Sync (cached data)
username = read 'username', 'username' # Sync (cached data)
```

#### **Web & Technical**
```rip
website = read! 'website', 'url'   # First call async (parses request body)
ip = read 'ip_address', 'ip'       # Sync (cached data)
mac = read 'mac', 'mac'            # Sync (cached data)
color = read 'color', 'color'      # Sync (cached data)
```

#### **Development & Standards**
```rip
version = read! 'version', 'semver' # First call async (parses request body)
user_id = read 'user_id', 'uuid'   # Sync (cached data)
slug = read 'slug', 'slug'         # Sync (cached data)
credit_card = read 'cc', 'creditcard' # Sync (cached data)
```

#### **Time & Money**
```rip
meeting = read! 'time', 'time24'   # First call async (parses request body)
appointment = read 'time', 'time12' # Sync (cached data)
price = read 'price', 'currency'   # Sync (cached data)
```

#### **Boolean & Collections**
```rip
active = read! 'active', 'bool'    # First call async (parses request body)
tags = read 'tags', 'array'        # Sync (cached data)
config = read 'config', 'hash'     # Sync (cached data)
admin_ids = read 'admins', 'ids'   # Sync (cached data)
```

### 🔥 Legendary Regex Patterns - The Secret Sauce

What makes `helpers.rip` truly revolutionary is **Rip's `=~` operator** - the most elegant regex syntax ever created.

#### **Pattern 1: Semicolon Pattern (Complex Transformations)**
```rip
# Perfect for complex operations like parsing and mathematical transformations
when 'id'
  val = (val =~ /^([1-9]\d{0,19})$/; if _ then parseInt(_[1]) else null)

when 'email'
  val = (val =~ /^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/; if _ then _[0].toLowerCase() else null)
```

#### **Pattern 2: Postfix If Pattern (Simple Validations)**
```rip
# Perfect for straightforward conditional transformations
when 'state'    then val = (_[1].toUpperCase() if val =~ /^([a-z][a-z])$/i)
when 'zip'      then val = (_[1] if val =~ /^(\d{5})/)
when 'ssn'      then val = ("#{_[1]}#{_[2]}#{_[3]}" if val =~ /^(\d{3})-?(\d{2})-?(\d{4})$/)
```

#### **Why This is Revolutionary**

**Traditional JavaScript** (verbose, error-prone):
```javascript
// Validate and transform state code
const stateMatch = value.match(/^([a-z]{2})$/i);
const state = stateMatch ? stateMatch[1].toUpperCase() : null;
if (!state) throw new Error('Invalid state');
```

**Rip with `=~`** (elegant, bulletproof):
```rip
# Validate and transform state code
state = (_[1].toUpperCase() if val =~ /^([a-z][a-z])$/i)
```

**Benefits**:
- **75% fewer characters** - Less typing, less bugs
- **Natural reading flow** - "Transform if condition" reads like English
- **Automatic null handling** - No manual error checking needed
- **Ruby-inspired elegance** - Familiar to experienced developers

### Advanced Usage Patterns

#### **Required Fields with Custom Error Handling**
```rip
# The ! suffix makes fields required
email = read! 'email', 'email!', -> signout!  # First call async (parses request body)
admin_role = read 'role', ['admin'], -> bail! 'Access denied'  # Sync (cached data)
```

#### **Complex Validation with Fallbacks**
```rip
# Array validation with default
roles = read! 'roles', ['admin', 'user', 'guest'], ['guest']  # First call async

# Regex validation (sync - cached data)
code = read 'code', /^[A-Z]{3,6}$/, -> throw new Error 'Invalid code'

# Range validation (sync - cached data)
priority = read 'priority', { start: 1, end: 10 }, 5
```

#### **Batch Processing**
```rip
# Process entire request payload
app.post '/api/users', ->
  # Get all user data in one call (parses request body, async)
  userData = read! null  # Returns: { name: "John", email: "john@...", ... }
  
  # Then validate individual fields as needed (sync - cached data)
  name = read 'name', 'name!'
  email = read 'email', 'email!'
  phone = read 'phone', 'phone'
```

### Real-World Impact: Before & After

#### **Before** (Traditional Node.js API):
```javascript
// 47 lines of validation boilerplate for a simple signup endpoint
app.post('/signup', async (req, res) => {
  try {
    const body = await req.json();

    // Email validation
    if (!body.email) throw new Error('Email required');
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(body.email)) throw new Error('Invalid email');
    const email = body.email.toLowerCase();

    // Name validation
    if (!body.name) throw new Error('Name required');
    const name = body.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Name cannot be empty');

    // Phone validation (optional)
    let phone = null;
    if (body.phone) {
      const digits = body.phone.replace(/\D/g, '');
      if (digits.length === 10) {
        const match = digits.match(/^(\d{3})(\d{3})(\d{4})$/);
        phone = match ? `${match[1]}-${match[2]}-${match[3]}` : null;
      }
    }

    // State validation
    if (!body.state) throw new Error('State required');
    const stateMatch = body.state.match(/^([a-z]{2})$/i);
    if (!stateMatch) throw new Error('Invalid state code');
    const state = stateMatch[1].toUpperCase();

    // Age validation
    const age = parseInt(body.age);
    if (isNaN(age) || age < 18 || age > 120) {
      throw new Error('Age must be between 18 and 120');
    }

    // Create user...
    const user = await createUser({ email, name, phone, state, age });
    res.json({ success: true, user });

  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

#### **After** (Rip with @rip/api):
```rip
# 6 lines total - same functionality, bulletproof validation, PURE SINATRA ELEGANCE!
import { read, c, withHelpers } from '@rip/api'

app.use withHelpers  # Enable Sinatra-style context-free everything!

app.post '/signup', ->  # NO context parameter needed!
  email = read! 'email', 'email!'                    # First call async (parses request body)
  name = read 'name', 'name!'                        # Subsequent calls sync (cached data)
  phone = read 'phone', 'phone'                      # Sync (cached data)
  state = read 'state', 'state!'                     # Sync (cached data)
  age = read 'age', { start: 18, end: 120 }, null    # Sync (cached data)

  user = createUser! { email, name, phone, state, age } # Use ! suffix for async operations
  c().json { success: true, user }  # Global context access - pure Sinatra style!
```

### Performance & Production Benefits

**1. Request Parsing Optimization**
- **Single parse operation** - Request body parsed once, cached for all field access
- **Smart type coercion** - Efficient conversion between strings, numbers, objects
- **Memory efficient** - No duplicate data structures or unnecessary copying

**2. Validation Performance**
- **Compiled regex patterns** - Pre-compiled for maximum speed
- **Short-circuit evaluation** - Stops at first validation failure
- **Optimized type checks** - Leverages JavaScript's native type checking

**3. Developer Productivity**
- **90% less validation code** - Focus on business logic, not boilerplate
- **Self-documenting APIs** - Validation rules are the documentation
- **Fewer bugs** - Bulletproof patterns eliminate common edge cases
- **Faster development** - From idea to production in minutes, not hours

## 🚀 Getting Started

### Installation
```bash
bun add @rip/api
```

### Basic Setup
```rip
import { read, withHelpers } from '@rip/api'
import { Hono } from 'hono'

app = new Hono()

# Enable helper binding (optional)
app.use withHelpers

# STYLE 1: Traditional with context parameter
app.post '/api/users', (ctx) ->
  email = read! 'email', 'email!'  # First call async (parses request body)
  name = read 'name', 'name!'      # Subsequent calls sync (cached data)
  ctx.json { success: true, user: { email, name } }

# STYLE 2: Pure Sinatra-style - NO context parameter!
app.post '/api/users', ->
  email = read! 'email', 'email!'  # First call async (parses request body)
  name = read 'name', 'name!'      # Subsequent calls sync (cached data)
  c().json { success: true, user: { email, name } }  # Global context access
```

### Migration from Traditional APIs

Replace verbose validation blocks with single `read()` calls:

```rip
# Instead of 10+ lines of manual validation:
email = read! 'email', 'email!'  # One line does it all - Sinatra elegance with ! suffix
```

## 🎯 Roadmap

**Phase 1** (Current): `helpers.rip` - Request validation & parsing
**Phase 2**: `middleware.rip` - Common middleware patterns
**Phase 3**: `responses.rip` - Structured response helpers
**Phase 4**: `validation.rip` - Advanced validation utilities
**Phase 5**: Framework adapters for Express, Fastify, etc.

## 🤝 Contributing

`@rip/api` represents the future of elegant API development. Contributions that enhance developer productivity and code clarity are welcome!

---

**Transform your API development from verbose boilerplate to pure poetry with `@rip/api`** 🔥

*"90% less code, 100% more clarity"*