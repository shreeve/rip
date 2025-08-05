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

## 🎯 Perfect Consistency with @rip/schema

**🔥 IDENTICAL SYNTAX EVERYWHERE!** Define your schema once with `@rip/schema`, then use the exact same validation syntax in your API with `read()`:

```rip
# Schema definition (packages/schema)
@model 'User', ->
  @string   'username', [3, 20]        # 3-20 characters
  @integer  'age', [18, 120]          # 18-120 years
  @email    'email', [5, 255]         # Email length limit
  @integer  'views', min: 0           # Non-negative numbers
  @text     'bio', max: 500           # Up to 500 characters

# API validation (packages/api) - IDENTICAL SYNTAX!
app.post '/users', ->
  username = read 'username', [3, 20]      # Same syntax!
  age = read 'age', [18, 120]             # Same syntax!
  email = read 'email', [5, 255]          # Same syntax!
  views = read 'views', min: 0             # Same syntax!
  bio = read 'bio', max: 500               # Same syntax!
  
  json success: true, user: { username, age, email, views, bio }
```

**✅ Benefits:**
- **Learn Once**: Same range syntax in schema and validation
- **No Mental Context Switching**: Consistent patterns everywhere
- **Perfect Maintainability**: Change validation rules in one place
- **Developer Happiness**: Elegant, predictable, beautiful

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
  email = read 'email', 'email!'     # All calls synchronous (middleware pre-parses)
  ctx.json { success: true, email }

# OPTION 2: Clean return or json helper - ULTIMATE ELEGANCE!
app.post '/signup', ->
  email = read 'email', 'email!'     # All calls synchronous (middleware pre-parses)
  phone = read 'phone', 'phone'      # Pure synchronous elegance!
  { success: true, email, phone }    # Return object (destructuring needs braces)
  # OR: json success: true, email, phone  # Smart json helper
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
- **37 Built-in Validators**: From emails to credit cards to UUIDs + JSON parsing
- **Rip's `=~` Operator**: Most elegant regex syntax ever created
- **Two Beautiful Styles**: Standard-if and postfix-if - choose what feels natural!
- **75% Less Code**: Compared to traditional JavaScript validation

**3. Mental Clarity & Developer Productivity**
- **Self-Documenting**: `read(c, 'email', 'email!')` tells the complete story
- **Required Fields**: The `!` suffix makes requirements crystal clear
- **Fallback Support**: Built-in handling for missing or invalid data
- **Zero Boilerplate**: No more manual parsing, validation, or error handling

### Core API: The `read()` Function

**Three calling styles supported**:

```rip
# Clean return or json helper - ULTIMATE ELEGANCE!
import { read, withHelpers } from '@rip/api'
app.post '/endpoint', ->
  data = read 'key', 'validator'  # All calls synchronous!
  { data }                        # Return object (destructuring needs braces)
  # OR: json data           # Clean json helper

# Traditional with context parameter
app.post '/endpoint', (ctx) ->
  data = read 'key', 'validator'  # All calls synchronous!
  ctx.json data

# Explicit context (backward compatible)
read(context, key, validator, fallback)
```

**Parameters**:
- **`key`**: Field name to extract (or `null` for entire payload)
- **`validator`**: Validation/transformation rule
- **`fallback`**: Value to use if validation fails (optional)

**Global Helpers**:
- **`read`**: Data validation and parsing - like `read 'email', 'email!'`
- **`json`**: Smart bidirectional JSON - parse strings OR send responses
- **`req`**: Request-only access - like `req.method`
- **`env`**: Full context access (when needed) - like `env.status(201)`

### Basic Usage Examples

```rip
import { read, withHelpers } from '@rip/api'

app.use withHelpers  # Enable Sinatra-style context-free calls

# STYLE 1: Traditional with context parameter
app.post '/api/users', (ctx) ->
  name = read 'name'              # All calls synchronous (middleware pre-parses)
  email = read 'email', 'email!'  # Pure synchronous elegance!
  ctx.json name, email

# STYLE 2: Clean return or json helper - ULTIMATE ELEGANCE!
app.post '/api/users', ->
  name = read 'name'              # All calls synchronous (middleware pre-parses)
  email = read 'email', 'email!'  # No async complexity!
  role = read 'role', ['admin', 'user'], 'user'  # Clean and simple!
  phone = read 'phone', 'phone'   # Pure elegance!

  # Just return data - cleanest approach!
  { name, email, role, phone }
  # OR: json { name, email, role, phone }  # Clean json helper
```

### 🔄 **Pure Synchronous Elegance: Middleware Pre-Parsing**

**Revolutionary Simplicity**: The `withHelpers` middleware pre-parses all request data, making every `read()` call synchronous!

**New Pattern** (Simplified!):
- **All calls**: `read 'key', ...` - Synchronous! (middleware pre-parses everything)
- **No more async**: Request body parsing handled by `withHelpers` middleware
- **Pure simplicity**: No need to worry about first call vs subsequent calls

**In Practice**: Just use `read()` everywhere - it's always synchronous and fast!

### 🎯 **Smart JSON Handling: `read` + `json` Helper**

**Two elegant approaches for JSON processing:**

#### **APPROACH 1: `read` with `json` Validator (RECOMMENDED)**
```rip
# Parse JSON data with validation - THE ELEGANT WAY!
app.post '/users', ->
  settings = read 'settings', 'json'  # String → Object with error handling
  preferences = read 'prefs', 'json'  # Handles both strings and objects

  # Use the parsed data
  theme = settings?.theme or 'light'
  { success: true, user: { settings, preferences } }
```

#### **APPROACH 2: Global `json` Helper (Alternative)**
```rip
# Direct JSON operations when needed
jsonString = '{"name": "John", "age": 30}'
user = json jsonString  # String → Object

# Serialize to string (no context)
data = name: "John", age: 30
jsonString = json data  # Object → String

# Send HTTP response (in endpoint)
json user  # Object → HTTP Response
```

**Why `read` + `json` validator is better:**
- **Consistent API**: Same pattern as all other validators
- **Error handling**: Graceful fallbacks for malformed JSON
- **Validation flow**: Integrates with existing validation pipeline
- **Schema ready**: Extensible for future JSON schema validation

### 🎯 **Clean API Design: Just Return Data**

**The cleanest approach - just return what you want to send:**

> **Note**: Object literals and destructuring require braces `{ }` - this is fundamental JavaScript/CoffeeScript syntax.

```rip
app.post '/api/users', ->
  # REQUEST ACCESS (when needed)
  method = req.method               # "POST"
  userAgent = req.header('User-Agent')

  # DATA PROCESSING (all synchronous!)
  email = read 'email', 'email!'
  name = read 'name', 'name!'
  age = read 'age', [18, 120]

  # RESPONSE - just return data!
  {
    success: true
    user: { email, name, age }
    meta: { created: new Date(), method }
  }

  # OR use smart json helper:
  # json { success: true, user: { email, name, age } }
```

**Perfect Sinatra Comparison:**
```ruby
# Ruby Sinatra
post '/api/users' do
  email = params[:email]
  name = params[:name]

  status 201
  headers 'X-API-Version' => '1.0'
  json({ user: { email: email, name: name } })
end
```

```rip
# Rip - even cleaner!
app.post '/api/users', ->
  email = read 'email'
  name = read 'name'

    # Just return data!
    { user: { email, name } }

  # OR: json user: { email, name }
```

### The 37 Built-in Validators

`helpers.rip` includes validators for every common API need:

#### **Basic Types**
```rip
id = read 'user_id', 'id!'        # All calls synchronous (middleware pre-parses)
count = read 'count', 'whole'      # Pure synchronous elegance
price = read 'price', 'decimal'    # No async complexity
cost = read 'cost', 'money'        # Clean and simple
```

#### **Text Processing**
```rip
title = read 'title', 'string'    # All calls synchronous (middleware pre-parses)
bio = read 'bio', 'text'           # Pure synchronous elegance
full_name = read 'name', 'name'    # Clean and simple
```

#### **Contact Information**
```rip
email = read 'email', 'email'     # All calls synchronous (middleware pre-parses)
phone = read 'phone', 'phone'      # No async complexity
address = read 'address', 'address' # Pure elegance
```

#### **Geographic Data**
```rip
state = read 'state', 'state'     # All calls synchronous (middleware pre-parses)
zip = read 'zip', 'zip'            # Clean and simple
zipplus4 = read 'zip', 'zipplus4'  # Pure elegance
```

#### **Identity & Security**
```rip
ssn = read 'ssn', 'ssn'           # All calls synchronous (middleware pre-parses)
sex = read 'gender', 'sex'         # No async complexity
username = read 'username', 'username' # Pure elegance
```

#### **Web & Technical**
```rip
website = read 'website', 'url'   # All calls synchronous (middleware pre-parses)
ip = read 'ip_address', 'ip'       # Clean and simple
mac = read 'mac', 'mac'            # Pure elegance
color = read 'color', 'color'      # No async complexity
```

#### **Development & Standards**
```rip
version = read 'version', 'semver' # All calls synchronous (middleware pre-parses)
user_id = read 'user_id', 'uuid'   # Pure elegance
slug = read 'slug', 'slug'         # Clean and simple
credit_card = read 'cc', 'creditcard' # No async complexity
```

#### **Time & Money**
```rip
meeting = read 'time', 'time24'   # All calls synchronous (middleware pre-parses)
appointment = read 'time', 'time12' # Pure elegance
price = read 'price', 'currency'   # Clean and simple
```

#### **Boolean & Collections**
```rip
active = read 'active', 'bool'    # All calls synchronous (middleware pre-parses)
tags = read 'tags', 'array'        # No async complexity
config = read 'config', 'hash'     # Pure elegance
settings = read 'settings', 'json' # Smart JSON parsing!
admin_ids = read 'admins', 'ids'   # Clean and simple
```

#### **Range Validation (Elegant!)**

**✅ Common Things Easy** - `[min, max]` (90% of use cases):
```rip
# Numbers: value range - super clean!
age = read 'age', [18, 120]        # Between 18 and 120
priority = read 'priority', [1, 10], 5  # Range 1-10, default 5
score = read 'score', [0, 100]     # Percentage validation
rating = read 'rating', [1, 5]     # Star rating system

# Strings: length range - equally clean!
username = read 'username', [3, 20]  # 3-20 characters
title = read 'title', [1, 100]      # 1-100 characters
bio = read 'bio', [0, 500]          # Up to 500 characters
code = read 'code', [6, 6]          # Exactly 6 characters
```

**🎯 Rare Things Possible** - `min:` / `max:` (10% of use cases):
```rip
# Only minimum (when max doesn't matter)
views = read 'views', min: 0          # Non-negative numbers
comment = read 'comment', min: 10     # At least 10 characters

# Only maximum (when min doesn't matter)
discount = read 'discount', max: 1.0  # Up to 100% discount
bio_short = read 'bio', max: 200      # Reasonable bio limit

# Explicit both (rare but clear)
custom_rating = read 'rating', min: 1, max: 5  # Explicit 1-5 range
```

**🎯 Perfect Design Philosophy:**
- **Common Things Easy**: `[min, max]` covers 90% of validation needs with shortest syntax
- **Rare Things Possible**: `min:` / `max:` handles edge cases with explicit clarity  
- **Identical to @rip/schema**: Same syntax everywhere for perfect consistency

### 🔥 Legendary Regex Patterns - The Secret Sauce

What makes `helpers.rip` truly revolutionary is **Rip's `=~` operator** - the most elegant regex syntax ever created.

**🎯 TWO BEAUTIFUL STYLES - CHOOSE YOUR PREFERENCE!**

Rip supports **both** conditional patterns, giving you the flexibility to write code that feels natural to YOU! This is what makes programming in Ruby, CoffeeScript, and **EVEN MORE SO in Rip** a joyful and fun experience!

#### **Style 1: Standard If Pattern (Condition First)**
```rip
# Great when you want to emphasize the condition logic
when 'id'
  val = (val =~ /^([1-9]\d{0,19})$/; if _ then parseInt(_[1]))

when 'state'
  val = (if val =~ /^([a-z][a-z])$/i then _[1].toUpperCase())

when 'zip'
  val = (if val =~ /^(\d{5})/ then _[1])

when 'email'
  val = (val =~ /^([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/; if _ then _[0].toLowerCase())
```

#### **Style 2: Postfix If Pattern (Action First)**
```rip
# Great when you want to emphasize the transformation result
when 'state'    then val = (_[1].toUpperCase() if val =~ /^([a-z][a-z])$/i)
when 'zip'      then val = (_[1] if val =~ /^(\d{5})/)
when 'zipplus4' then val = ("#{_[1]}-#{_[2]}" if val =~ /^(\d{5})-?(\d{4})$/)
when 'ssn'      then val = ("#{_[1]}#{_[2]}#{_[3]}" if val =~ /^(\d{3})-?(\d{2})-?(\d{4})$/)
```

#### **🎉 Choose Your Style - Both Are Beautiful!**

**The magic is in the CHOICE!** Pick the style that feels natural for each situation:

- **Standard If**: When you want to emphasize the condition logic
- **Postfix If**: When you want to emphasize the transformation result
- **Mix and Match**: Use both in the same codebase - consistency is overrated when expressiveness wins!

**This flexibility is what makes programming in Ruby, CoffeeScript, and EVEN MORE SO in Rip a joyful and fun experience!** 🚀

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
email = read 'email', 'email!', -> signout!  # All calls synchronous (middleware pre-parses)
admin_role = read 'role', ['admin'], -> bail! 'Access denied'  # Pure elegance
```

#### **Complex Validation with Fallbacks**
```rip
# Array validation with default
roles = read 'roles', ['admin', 'user', 'guest'], ['guest']  # All calls synchronous

# Regex validation (clean and simple)
code = read 'code', /^[A-Z]{3,6}$/, -> throw new Error 'Invalid code'

# Range validation (pure elegance)
priority = read 'priority', { start: 1, end: 10 }, 5
```

#### **Batch Processing**
```rip
# Process entire request payload
app.post '/api/users', ->
  # Get all user data in one call (synchronous!)
  userData = read null  # Returns: { name: "John", email: "john@...", ... }

  # Then validate individual fields as needed (all synchronous)
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
  email = read 'email', 'email!'                    # All calls synchronous (middleware pre-parses)
  name = read 'name', 'name!'                        # Pure synchronous elegance
  phone = read 'phone', 'phone'                      # No async complexity
  state = read 'state', 'state!'                     # Clean and simple
  age = read 'age', [18, 120], null    # Pure elegance

  user = createUser! email, name, phone, state, age # Use ! suffix for async operations
  { success: true, user }  # Just return data - cleanest approach!
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
  email = read 'email', 'email!'  # All calls synchronous (middleware pre-parses)
  name = read 'name', 'name!'      # Pure synchronous elegance
  ctx.json { success: true, user: { email, name } }

# STYLE 2: Clean return - ULTIMATE ELEGANCE!
app.post '/api/users', ->
  email = read 'email', 'email!'  # All calls synchronous (middleware pre-parses)
  name = read 'name', 'name!'      # No async complexity
  { success: true, user: { email, name } }  # Just return data!
```

### Migration from Traditional APIs

Replace verbose validation blocks with single `read()` calls:

```rip
# Instead of 10+ lines of manual validation:
email = read 'email', 'email!'  # One line does it all
{ success: true, email }  # Just return data - cleanest approach!
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