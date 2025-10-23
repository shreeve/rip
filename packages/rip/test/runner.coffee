#!/usr/bin/env coffee

import fs from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'
import CoffeeScript from '../lib/coffeescript/index.js'

# ANSI colors
bold   = '\x1B[0;1m'
red    = '\x1B[0;31m'
green  = '\x1B[0;32m'
yellow = '\x1B[0;33m'
reset  = '\x1B[0m'

# Test state
passed = 0
failed = 0
failures = []
currentFile = null

# Get current directory
__dirname = path.dirname fileURLToPath(import.meta.url)

# Helper to check equality
equal = (actual, expected) ->
  if actual is expected
    true
  else if Array.isArray(actual) and Array.isArray(expected)
    return false if actual.length isnt expected.length
    actual.every (val, i) -> equal val, expected[i]
  else if actual?.constructor is Object and expected?.constructor is Object
    keys1 = Object.keys(actual).sort()
    keys2 = Object.keys(expected).sort()
    return false if not equal keys1, keys2
    keys1.every (key) -> equal actual[key], expected[key]
  else
    false

# Test functions that will be made global
#
# Note about backticks and template literals:
# - CoffeeScript passes through single backticks (`) as raw JavaScript
# - CoffeeScript's string interpolation "#{}" compiles to JS template literals `${}`
# - To embed actual JS template literals in tests, use triple backticks:
#   ```
#   `hello ${x}`
#   ```
# - Be careful: the test runner uses eval() which can conflict with template literals
# - For tests that need template literals, prefer using triple single quotes (''')
#   instead of triple double quotes (""") to avoid template literal evaluation issues
global.test = (description, source, expected) ->
  # Handle optional description
  if arguments.length is 2
    [source, expected] = [description, source]
    description = "test"

  do ->  # Wrap in async context to allow await
    try
      # Compile and run the code
      compiled = CoffeeScript.compile source, bare: yes
      result = eval(compiled)

      # Handle async results
      if result?.then
        result = await result

      if equal result, expected
        passed++
        console.log "  #{green}✓ #{description}#{reset}"
      else
        failed++
        console.log "  #{red}✗ #{description}#{reset}"
        console.log "    Expected: #{JSON.stringify expected}"
        console.log "    Got:      #{JSON.stringify result}"
    catch err
      failed++
      console.log "  #{red}✗ #{description} (error)#{reset}"
      console.log "    #{err.message}"

global.code = (description, source, expectedJS) ->
  if arguments.length is 2
    [source, expectedJS] = [description, source]
    description = "code"

  try
    actualJS = CoffeeScript.compile source, bare: yes
    actualClean = actualJS.trim().replace(/\s+/g, ' ')
    expectedClean = expectedJS.trim().replace(/\s+/g, ' ')

    if actualClean is expectedClean
      passed++
      console.log "  #{green}✓ #{description}#{reset}"
    else
      failed++
      console.log "  #{red}✗ #{description}#{reset}"
  catch err
    failed++
    console.log "  #{red}✗ #{description} (compilation error)#{reset}"

global.fail = (description, source) ->
  if arguments.length is 1
    source = description
    description = "fail"

  try
    CoffeeScript.compile source, bare: yes
    failed++
    console.log "  #{red}✗ #{description}#{reset}"
    console.log "    Expected compilation to fail"
  catch err
    passed++
    console.log "  #{green}✓ #{description}#{reset}"

# Find test files
findCoffeeFiles = (dir) ->
  results = []
  for file in fs.readdirSync(dir)
    filePath = path.join dir, file
    stat = fs.statSync filePath
    if stat.isDirectory()
      continue if file is 'node_modules' or file.startsWith('.')
      results = results.concat findCoffeeFiles(filePath)
    else if file.endsWith('.coffee') and file isnt 'runner.coffee'
      results.push filePath
  results

# Run tests
runTests = ->
  # Get test files from arguments or default to current directory
  testPaths = process.argv[2..]
  testPaths = ['.'] if testPaths.length is 0

  testFiles = []
  for testPath in testPaths
    fullPath = path.resolve testPath

    # Check if path exists
    if not fs.existsSync(fullPath)
      console.log "#{red}Error: File or directory not found: #{testPath}#{reset}"

      # Try to provide helpful suggestions
      if testPath.endsWith('.coffee')
        # Check if they forgot "old/" subdirectory
        altPath = path.join(path.dirname(testPath), 'old', path.basename(testPath))
        if fs.existsSync(path.resolve(altPath))
          console.log "#{yellow}Did you mean: #{altPath}?#{reset}"

      process.exit 1

    stat = fs.statSync fullPath
    if stat.isDirectory()
      testFiles = testFiles.concat findCoffeeFiles(fullPath)
    else if stat.isFile() and testPath.endsWith('.coffee')
      testFiles.push fullPath
    else if stat.isFile()
      console.log "#{yellow}Warning: Skipping non-CoffeeScript file: #{testPath}#{reset}"
    else
      console.log "#{yellow}Warning: Unknown file type: #{testPath}#{reset}"

  # Exit gracefully if no test files found
  if testFiles.length is 0
    console.log "#{yellow}No test files found.#{reset}"
    process.exit 0

  console.log "#{bold}Running #{testFiles.length} test file(s)#{reset}\n"

  # Save the original test functions once
  originalTest = global.test
  originalCode = global.code
  originalFail = global.fail

  # Run each test file
  for file in testFiles
    currentFile = file
    relativePath = path.relative process.cwd(), file
    console.log "#{bold}#{relativePath}:#{reset}"

    try
      # Read and execute the test file
      source = fs.readFileSync file, 'utf8'
      compiled = CoffeeScript.compile source, bare: yes, filename: file

      # Collect test promises
      global.testPromises = []
      global.test = (description, source, expected) ->
        promise = originalTest(description, source, expected)
        global.testPromises.push promise if promise?.then
        promise

      # Execute in global context with test functions available
      eval(compiled)

      # Wait for all tests to complete
      await Promise.all(global.testPromises) if global.testPromises.length > 0

    catch err
      failed++
      console.log "  #{red}✗ Failed to run test file#{reset}"
      console.log "    #{err.message}"

    console.log ""

  # Restore original functions after all tests
  global.test = originalTest
  global.code = originalCode
  global.fail = originalFail

  # Print summary
  console.log "#{bold}─────────────────────────────────────#{reset}"

  if failed is 0
    console.log "#{green}#{bold}All tests passed!#{reset}"
    console.log "#{green}✓ #{passed} passing#{reset}"
  else
    console.log "#{red}#{bold}Test failures detected#{reset}"
    console.log "#{green}✓ #{passed} passing#{reset}"
    console.log "#{red}✗ #{failed} failing#{reset}"

  process.exit(if failed > 0 then 1 else 0)

# Run the tests
do runTests
