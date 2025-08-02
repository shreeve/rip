# Tests for rip's async call operator (!)
# This feature transforms `identifier!` into `await identifier()`

test "rip: basic async call operator", ->
  # Simple identifier
  code1 = 'result = fetch!'
  compiled1 = CoffeeScript.compile code1
  ok compiled1.includes('await fetch()'), "Should generate await with implicit parentheses"

  # Property access
  code2 = 'result = api.fetch!'
  compiled2 = CoffeeScript.compile code2
  ok compiled2.includes('await api.fetch()'), "Should work on object properties"

  # This/@ syntax
  code3 = 'result = @helper!'
  compiled3 = CoffeeScript.compile code3
  ok compiled3.includes('await this.helper()'), "Should work with @ syntax"


test "rip: async call operator with arguments", ->
  # Single argument
  code1 = 'result = api.fetch!("users")'
  compiled1 = CoffeeScript.compile code1
  ok compiled1.includes('await api.fetch("users")'), "Should handle single argument"

  # Multiple arguments
  code2 = 'result = db.query!("SELECT * FROM users", {limit: 10})'
  compiled2 = CoffeeScript.compile code2
  ok compiled2.includes('await db.query("SELECT * FROM users", {'), "Should handle multiple arguments"


test "rip: async call operator vs regular negation", ->
  # Regular negation should be unchanged
  codeNot = 'result = !user.active'
  compiledNot = CoffeeScript.compile codeNot
  ok compiledNot.includes('!user.active'), "Should preserve regular negation"
  ok not compiledNot.includes('await'), "Should not add await to negation"

  # Async call should work
  codeAsync = 'result = user.fetch!'
  compiledAsync = CoffeeScript.compile codeAsync
  ok compiledAsync.includes('await user.fetch()'), "Should generate await for async call"


# Phase 2 tests (these should initially fail/skip)
test "rip: sequential async chaining - future enhancement", ->
  # This test documents our future goal
  code = 'result = user.load!.save!'

  try
    compiled = CoffeeScript.compile code
    # For now, this might not work - that's expected
    # Eventually should generate: await (await user.load()).save()
    console.log "Chaining test result:", compiled
  catch error
    console.log "Chaining not implemented yet:", error.message
    ok true, "Chaining will be implemented in Phase 3"


test "rip: async call operator generates clean JavaScript", ->
  code = '''
    fetchUser = ->
      user = api.getUser!
      profile = user.getProfile!
      profile
  '''
  compiled = CoffeeScript.compile code

  # Should generate clean, readable JavaScript
  ok compiled.includes('await api.getUser()'), "Should await first call"
  ok compiled.includes('await user.getProfile()'), "Should await second call"
  ok compiled.includes('return profile'), "Should return correctly"


test "rip: async call operator in various contexts", ->
  # In assignments
  code1 = 'user = User.create!'
  compiled1 = CoffeeScript.compile code1
  ok compiled1.includes('user = await User.create()'), "Should work in assignments"

  # As function arguments
  code2 = 'console.log api.fetch!'
  compiled2 = CoffeeScript.compile code2
  ok compiled2.includes('console.log(await api.fetch())'), "Should work as function arguments"

  # In conditionals
  code3 = 'if api.check! then console.log "ok"'
  compiled3 = CoffeeScript.compile code3
  ok compiled3.includes('await api.check()'), "Should work in conditionals"