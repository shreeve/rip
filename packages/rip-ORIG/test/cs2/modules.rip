# Module Syntax
# -------------

# Note: These tests verify that module syntax compiles without errors.
# We're not testing the actual module resolution or execution.

# Import statements compile
test 'import side effects', """
  `import 'lib'`
  true
""", true

test 'import default', """
  `import foo from 'lib'`
  true
""", true

test 'import namespace', """
  `import * as lib from 'lib'`
  true
""", true

test 'import named', """
  `import { foo } from 'lib'`
  true
""", true

test 'import named with alias', """
  `import { foo as bar } from 'lib'`
  true
""", true

test 'import multiple', """
  `import { foo, bar } from 'lib'`
  true
""", true

test 'import default and named', """
  `import foo, { bar } from 'lib'`
  true
""", true

test 'import default and namespace', """
  `import foo, * as lib from 'lib'`
  true
""", true

# Export statements compile
test 'export default', """
  `export default 42`
  true
""", true

test 'export named', """
  `export { foo }`
  true
""", true

test 'export named with alias', """
  `export { foo as bar }`
  true
""", true

test 'export from', """
  `export { foo } from 'lib'`
  true
""", true

test 'export all from', """
  `export * from 'lib'`
  true
""", true

test 'export namespace from', """
  `export * as ns from 'lib'`
  true
""", true

# Dynamic import
test 'dynamic import', """
  fn = -> `import('lib')`
  typeof fn
""", 'function'

# Import/export with assertions (ES2020)
test 'import with assertion', """
  `import data from './data.json' assert { type: 'json' }`
  true
""", true

test 'export with assertion', """
  `export { data } from './data.json' assert { type: 'json' }`
  true
""", true
