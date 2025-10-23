# CoffeeScript ES Module Loader
# Similar to the old register.coffee but for ES modules
# Usage: node --loader coffeescript/lib/coffeescript/loader.js

import {pathToFileURL} from 'url'
import {readFileSync} from 'fs'
import CoffeeScript from './index.js'

# Resolve hook - handles .coffee file imports
export resolve = (specifier, context, nextResolve) ->
  # Handle .coffee file imports
  if specifier.endsWith '.coffee'
    url = new URL(specifier, context.parentURL).href
    return {
      url
      format: 'module'
      shortCircuit: true
    }

  # Pass through all other imports
  nextResolve specifier, context

# Load hook - compiles .coffee files to ES modules
export load = (url, context, nextLoad) ->
  # Compile .coffee files to ES modules
  if url.endsWith '.coffee'
    source = readFileSync new URL(url), 'utf8'
    compiled = CoffeeScript.compile source,
      bare: true
      filename: url

    return {
      format: 'module'
      source: compiled
      shortCircuit: true
    }

  # Pass through all other files
  nextLoad url, context
