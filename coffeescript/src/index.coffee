# Node.js Implementation
import * as CoffeeScript from './coffeescript.js'
import fs from 'fs'
import vm from 'vm'
import path from 'path'

helpers       = CoffeeScript.helpers

export transpile = (js, options) ->
  try
    babel = require '@babel/core'
  catch
    try
      babel = require 'babel-core'
    catch
      # This error is only for Node, as CLI users will see a different error
      # earlier if they don’t have Babel installed.
      throw new Error 'To use the transpile option, you must have the \'@babel/core\' module installed'
  babel.transform js, options

# The `compile` method particular to the Node API.
export compile = (code, options) ->
  # Pass a reference to Babel into the compiler, so that the transpile option
  # is available in the Node API. We need to do this so that tools like Webpack
  # can `require('coffeescript')` and build correctly, without trying to
  # require Babel.
  if options?.transpile
    options.transpile.transpile = transpile
  CoffeeScript.compile code, options

# Compile and execute a string of CoffeeScript (on the server), correctly
# setting `__filename`, `__dirname`, and relative `require()`.
export run = (code, options = {}) ->
  mainModule = require.main

  # Set the filename.
  mainModule.filename = process.argv[1] =
    if options.filename then fs.realpathSync(options.filename) else helpers.anonymousFileName()

  # Clear the module cache.
  mainModule.moduleCache and= {}

  # Assign paths for node_modules loading
  dir = if options.filename?
    path.dirname fs.realpathSync options.filename
  else
    fs.realpathSync '.'
  mainModule.paths = require('module')._nodeModulePaths dir

  # Save the options for compiling child imports.
  mainModule.options = options

  options.filename = mainModule.filename
  options.inlineMap = true

  # Compile.
  answer = CoffeeScript.compile code, options
  code = answer.js ? answer

  mainModule._compile code, mainModule.filename

# Compile and evaluate a string of CoffeeScript (in a Node.js-like environment).
# The CoffeeScript REPL uses this to run the input.
export coffeeEval = (code, options = {}) ->
  return unless code = code.trim()
  createContext = vm.Script.createContext ? vm.createContext

  isContext = vm.isContext ? (ctx) ->
    options.sandbox instanceof createContext().constructor

  if createContext
    if options.sandbox?
      if isContext options.sandbox
        sandbox = options.sandbox
      else
        sandbox = createContext()
        sandbox[k] = v for own k, v of options.sandbox
      sandbox.global = sandbox.root = sandbox.GLOBAL = sandbox
    else
      sandbox = global
    sandbox.__filename = options.filename || 'eval'
    sandbox.__dirname  = path.dirname sandbox.__filename
    # define module/require only if they chose not to specify their own
    unless sandbox isnt global or sandbox.module or sandbox.require
      Module = require 'module'
      sandbox.module  = _module  = new Module(options.modulename || 'eval')
      sandbox.require = _require = (path) ->  Module._load path, _module, true
      _module.filename = sandbox.__filename
      for r in Object.getOwnPropertyNames require when r not in ['paths', 'arguments', 'caller']
        _require[r] = require[r]
      # use the same hack node currently uses for their own REPL
      _require.paths = _module.paths = Module._nodeModulePaths process.cwd()
      _require.resolve = (request) -> Module._resolveFilename request, _module
  o = {}
  o[k] = v for own k, v of options
  o.bare = on # ensure return value
  js = CoffeeScript.compile code, o
  if sandbox is global
    vm.runInThisContext js
  else
    vm.runInContext js, sandbox

export register = -> require './register'

# Throw error with deprecation warning when depending upon implicit `require.extensions` registration
if require.extensions
  for ext in CoffeeScript.FILE_EXTENSIONS then do (ext) ->
    require.extensions[ext] ?= ->
      throw new Error """
      Use CoffeeScript.register() or require the coffeescript/register module to require #{ext} files.
      """

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
