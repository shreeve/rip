#!/usr/bin/env bun

/**
 * RIP Language CLI
 *
 * The future clean RIP compiler command-line interface.
 * Currently under construction as we "build the 747 mid-flight".
 */

import { readFileSync } from 'fs'
import { parseArgs } from 'util'
import { VERSION, compile } from './index.ts'

function showHelp() {
  console.log(`
RIP Language Compiler v${VERSION}

Usage:
  rip [options] [files...]
  rip --compile file.rip
  rip --eval "code"

Options:
  -c, --compile        Compile files to JavaScript
  -e, --eval           Evaluate RIP code directly
  -o, --output <file>  Output file (default: stdout)
  -b, --bare           Compile without top-level function wrapper
  -s, --source-map     Generate source maps
  -w, --watch          Watch files for changes
  -h, --help           Show this help message
  -v, --version        Show version number

Examples:
  rip app.rip                    # Run RIP file directly
  rip -c src/app.rip             # Compile to JavaScript
  rip -c -o dist/ src/*.rip      # Compile multiple files
  rip -e "console.log 'Hello!'"  # Evaluate RIP code

Note: This is the future clean RIP implementation.
Currently using CoffeeScript-based implementation in /coffeescript.
`)
}

function showVersion() {
  console.log(`RIP Language v${VERSION}`)
  console.log('Clean implementation (under construction)')
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      compile: { type: 'boolean', short: 'c' },
      eval: { type: 'string', short: 'e' },
      output: { type: 'string', short: 'o' },
      bare: { type: 'boolean', short: 'b' },
      'source-map': { type: 'boolean', short: 's' },
      watch: { type: 'boolean', short: 'w' },
    },
    allowPositionals: true,
  })

  if (values.help) {
    showHelp()
    return
  }

  if (values.version) {
    showVersion()
    return
  }

  // For now, show a message that this is under construction
  console.log('🚧 RIP Clean Compiler - Under Construction')
  console.log('')
  console.log(
    'This is the future home of the clean RIP language implementation.',
  )
  console.log('Currently using the CoffeeScript-based implementation.')
  console.log('')
  console.log('To use RIP now, try:')
  console.log('  ./coffeescript/bin/coffee your-file.rip')
  console.log('  bun your-file.rip  (with rip-bun plugin)')
  console.log('')
  console.log('Building the 747 mid-flight... 🛩️✨')
}

// Only run main if this file is executed directly
if (import.meta.main) {
  main().catch(console.error)
}
