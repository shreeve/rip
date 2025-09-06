# Node.js Implementation
import * as CoffeeScript from './coffeescript.js'
import fs from 'fs'
import vm from 'vm'
import path from 'path'

helpers       = CoffeeScript.helpers

export transpile = (js, options) ->
  # Note: In ESM mode, dynamic imports would need to be handled differently
  # For now, transpilation with Babel is not supported in pure ESM mode
  throw new Error 'Transpilation is not yet supported in ESM mode. Compile to JS first, then use Babel separately.'

# The `compile` method particular to the Node API.
export compile = (code, options) ->
  # In ESM mode, transpilation is handled separately
  if options?.transpile
    throw new Error 'Transpilation is not supported in ESM mode. Compile to JS first, then use Babel separately.'
  CoffeeScript.compile code, options

# Compile and execute a string of CoffeeScript (on the server)
# Note: This function relies on CommonJS features and is not fully compatible with ESM
export run = (code, options = {}) ->
  # For ESM, we just compile and return the JavaScript
  # Full execution with module context would require a different approach
  answer = CoffeeScript.compile code, options
  answer.js ? answer

# Compile and evaluate a string of CoffeeScript (in a Node.js-like environment).
# The CoffeeScript REPL uses this to run the input.
export coffeeEval = (code, options = {}) ->
  return unless code = code.trim()
  
  createContext = vm.Script.createContext ? vm.createContext
  isContext = vm.isContext ? (ctx) ->
    options.sandbox instanceof createContext().constructor

  # Set up sandbox for evaluation
  if options.sandbox?
    if isContext options.sandbox
      sandbox = options.sandbox
    else
      sandbox = createContext()
      sandbox[k] = v for own k, v of options.sandbox
    sandbox.global = sandbox.root = sandbox.GLOBAL = sandbox
  else
    sandbox = global
  
  # Basic filename/dirname setup
  sandbox.__filename = options.filename || 'eval'
  sandbox.__dirname  = path.dirname sandbox.__filename
  
  # Note: In ESM mode, we cannot provide CommonJS module/require in the sandbox
  # This functionality would need to be implemented differently for ESM
  
  # Compile the code
  o = {}
  o[k] = v for own k, v of options
  o.bare = on # ensure return value
  js = CoffeeScript.compile code, o
  
  # Execute in the appropriate context
  if sandbox is global
    vm.runInThisContext js
  else
    vm.runInContext js, sandbox

export register = -> 
  throw new Error "register() is not available in ESM mode. Use import syntax instead."

# Note: require.extensions is not available in ESM
# This deprecation warning is only relevant for CommonJS environments

export _compileRawFileContent = (raw, filename, options = {}) ->

  # Strip the Unicode byte order mark, if this file begins with one.
  stripped = if raw.charCodeAt(0) is 0xFEFF then raw.substring 1 else raw

  options = Object.assign {}, options,
    filename: filename
    sourceFiles: [filename]

  try
    answer = CoffeeScript.compile stripped, options
  catch err
    # As the filename and code of a dynamically loaded file will be different
    # from the original file compiled with CoffeeScript.run, add that
    # information to error so it can be pretty-printed later.
    throw helpers.updateSyntaxError err, stripped, filename

  answer

export _compileFile = (filename, options = {}) ->
  raw = fs.readFileSync filename, 'utf8'

  CoffeeScript._compileRawFileContent raw, filename, options

# Re-export everything from CoffeeScript
export * from './coffeescript.js'

# Export coffeeEval as eval for compatibility
export {coffeeEval as eval}
