# index.coffee - Pure ES6 module version for cross-runtime compatibility
# Works with: Node.js, Bun, Deno, and browsers

import * as CoffeeScriptCore from './coffeescript'

# Create an enhanced object that includes both core functionality and Node.js-specific methods
CoffeeScript = Object.assign {}, CoffeeScriptCore,
  # Add Node.js-specific methods for CLI compatibility
  run: (code, options = {}) ->
    # Simple implementation for Node.js compatibility
    if typeof process isnt 'undefined' and process.versions?.node
      vm = await import('vm')
      compiled = CoffeeScriptCore.compile code, Object.assign({bare: true}, options)
      return vm.runInThisContext(compiled.js ? compiled)
    else
      throw new Error('CoffeeScript.run is only available in Node.js environments')

  eval: (code, options = {}) ->
    # Simplified eval for compatibility
    return unless code = code.trim()
    compiled = CoffeeScriptCore.compile code, Object.assign({bare: true}, options)

    # Use eval to execute the compiled code
    func = eval
    return func(compiled.js ? compiled)

# Re-export everything from coffeescript
export * from './coffeescript'

# Export the enhanced CoffeeScript object as default
export default CoffeeScript