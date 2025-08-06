# 🔥 Revolutionary API Syntax - AI Help Documentation

## Problem Summary
We're implementing a revolutionary clean syntax for HTTP APIs that eliminates boilerplate and provides automatic response type detection. The implementation is 95% complete but has a critical timing issue preventing it from working.

## Current Issue
**Error**: `ReferenceError: patch is not defined` at module load time
**Root Cause**: Global helper functions (`get`, `post`, `patch`, etc.) are not available when the module loads

## What We're Building

### Revolutionary Syntax (Goal)
```rip
# Before (verbose Hono syntax)
app.get '/ping', (c) -> c.text('pong')
app.get '/user', (c) -> c.json({ name: 'larry', role: 'admin' })

# After (revolutionary clean syntax)
get '/ping', -> 'pong'                    # Auto-detects string → text response
get '/user', -> name: 'larry', role: 'admin'  # Auto-detects object → JSON response
```

### Auto-Response Detection
- **String return** → `c.text(result)`
- **Object return** → `c.json(result)`
- **Number/Boolean** → `c.text(result.toString())`

## Architecture

### Key Files
1. **`apps/labs/api/index.rip`** - Main application using clean syntax
2. **`packages/api/helpers.rip`** - Global helpers implementation
3. **`packages/server/worker.ts`** - Module loader (shows error messages)

### Implementation Components

#### 1. Global Helper Functions (`packages/api/helpers.rip`)
```coffeescript
# Global functions defined with Object.defineProperty
Object.defineProperty global, 'get',
  value: (path, handler) ->
    if _currentApp?
      _currentApp.get path, smartRoute(handler)
    else
      # Queue the route for later registration
      _routeQueue.push { method: 'get', path, handler }
configurable: true
```

#### 2. Smart Route Wrapper
```coffeescript
smartRoute = (handler) ->
  (c) ->
    _currentContext = c
    try
      result = handler(c)
      if result?
        if typeof result == 'string'
          return c.text(result)
        else if typeof result == 'object'
          return c.json(result)
        # ... handle other types
      return result
    finally
      _currentContext = null
```

#### 3. Route Queueing System
```coffeescript
_routeQueue = []  # Queue routes during module load
_currentApp = null

export withHelpers = (app) ->
  _currentApp = app

  # Process any queued routes
  for route in _routeQueue
    switch route.method
      when 'get' then app.get route.path, smartRoute(route.handler)
      when 'post' then app.post route.path, smartRoute(route.handler)
      # ... etc

  _routeQueue = []  # Clear queue

  # ... middleware setup
  return app
```

## Current Status

### ✅ What Works
- **Minimal files work**: Server can load and run simple `.rip` files
- **Basic Hono syntax works**: `app.get '/test', (c) -> c.text('hello')`
- **Module compilation works**: CoffeeScript compiles `.rip` files correctly
- **Global helpers are defined**: `Object.defineProperty global, 'get'` executes

### ❌ What Fails
- **Complex file with global helpers fails**: `ReferenceError: patch is not defined`
- **Timing issue**: Global functions not available at module load time

### Error Details
```
Failed to import index.rip: 96 | patch("/user/me", function() {
     ^
ReferenceError: patch is not defined
     at /Users/shreeve/Data/Code/rip/apps/labs/api/index.rip:139:1
     at requestImportModule (1:11)
```

## The Timing Problem

### Module Loading Sequence
1. **Module Load Time**: `index.rip` is imported
   - CoffeeScript compiles: `patch('/user/me', function() { ... })`
   - JavaScript executes: Calls `patch()` function
   - **ERROR**: `patch` is not defined yet!

2. **Runtime**: `withHelpers(app)` would be called
   - Sets `_currentApp = app`
   - Processes `_routeQueue`
   - But we never get here because module loading failed

### Key Insight
The global helper functions are defined in `helpers.rip`, but they're not available when `index.rip` loads because:
- `helpers.rip` needs to be imported and executed first
- The global functions are defined via `Object.defineProperty global, 'get'`
- But `index.rip` tries to call `get()`, `patch()`, etc. during compilation/loading

## Potential Solutions

### Option 1: Immediate Global Definition
Ensure global functions are available immediately when `@rip/api` is imported, not just after `withHelpers()` is called.

### Option 2: Different Module Loading Strategy
Change how the worker loads modules to ensure helpers are available first.

### Option 3: Deferred Execution
Wrap the route definitions in a function that executes after helpers are ready.

### Option 4: Build-Time Transformation
Transform the clean syntax at build time rather than runtime.

## Testing

### Minimal Working Example
```rip
# This works (apps/labs/api/index-minimal.rip)
import { Hono } from 'hono'
app = new Hono
app.get '/test', (c) -> c.text('hello world')
export default app
```

### Failing Complex Example
```rip
# This fails (apps/labs/api/index.rip)
import { withHelpers, read } from '@rip/api'
app = new Hono
app = withHelpers app
get '/ping', -> 'pong'  # ← ReferenceError: get is not defined
```

## Debug Commands

```bash
# Test minimal file
cd apps/labs/api
mv index.rip index-complex.rip
mv index-minimal.rip index.rip
curl http://localhost:8305/test  # Should work

# Test complex file
mv index.rip index-minimal.rip
mv index-complex.rip index.rip
curl http://localhost:8305/ping  # Fails with ReferenceError
```

## Key Questions for Solution

1. **When are global functions available?** The `Object.defineProperty global, 'get'` calls happen in `helpers.rip`, but when does that execute relative to `index.rip`?

2. **Import order**: Does `import { withHelpers } from '@rip/api'` execute the global property definitions immediately?

3. **Module loading**: How does the Bun/CoffeeScript module system handle global modifications across modules?

4. **Alternative approaches**: Should we use a different pattern entirely (e.g., proxy objects, build-time transforms, or deferred execution)?

## Expected Outcome

When fixed, this should work flawlessly:

```rip
import { withHelpers, read } from '@rip/api'
app = new Hono
app = withHelpers app

# Revolutionary clean syntax with auto-detection
get '/ping', -> 'pong'                           # → c.text('pong')
get '/user/:id', -> user: { id: read('id') }     # → c.json({user: {id: ...}})
post '/orders', -> order: createOrder()          # → c.json({order: ...})
put '/users/:id', -> 'updated successfully'      # → c.text('updated successfully')

export default app
```

## Files to Examine

1. **`packages/api/helpers.rip`** - Global helper definitions
2. **`apps/labs/api/index.rip`** - Main application using clean syntax
3. **`packages/server/worker.ts`** - Module loader showing errors
4. **Terminal logs** - Show exact error: `ReferenceError: patch is not defined`

The solution likely involves ensuring the global helper functions are available immediately when the module loads, before any route definitions are processed.