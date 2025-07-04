// Modern ESM CLI for rip-parser
// Supports .js, .mjs, and legacy .coffee grammar files
// Requires Node.js 14+
// Assumes you have a Generator class available as an ES module (see import below)

import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { Generator } from './generator.mjs'

const [,, file, ...rest] = process.argv
if (!file) {
  console.log('Usage: node rip-parser.mjs <grammar-file> [-o <output-file>]')
  process.exit(1)
}
const idx = rest.indexOf('-o')
const out = (idx !== -1 && rest[idx+1]) ? rest[idx+1] : path.basename(file, path.extname(file)) + '-parser.js'

// Register CoffeeScript if needed
if (file.endsWith('.coffee')) {
  // Dynamically import CoffeeScript/register
  await import('coffeescript/register')
}

// Dynamically import the grammar file (works for .js, .mjs, .coffee)
let lang
try {
  // Resolve absolute path for import()
  const absPath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)
  const imported = await import(pathToFileURL(absPath).href)
  lang = imported.default || imported
} catch (error) {
  console.error(`Error loading grammar file: ${error.message}`)
  process.exit(1)
}

let parser_code
if (lang.grammar) {
  const grammar = {
    bnf: lang.grammar,
    tokens: lang.tokens,
    operators: lang.operators,
    start: lang.startSymbol || 'Root',
    parseParams: lang.parseParams || [],
    moduleInclude: lang.moduleInclude || '',
    actionInclude: lang.actionInclude || ''
  }
  parser_code = (new Generator(grammar)).generate()
} else if (lang.parser) {
  parser_code = lang.parser.generate()
} else {
  throw new Error('Grammar file must export either { grammar, tokens, operators, startSymbol } or { parser }')
}

await fs.writeFile(out, parser_code)
console.log(`Generated parser: ${out}`)
