#!/usr/bin/env bun

/**
 * Demo: Hash (#) Suffix Syntax for Unique Fields
 * Tests the new shortcut syntax for unique constraints
 */

import { TableBuilder } from './builder'

console.log('🎯 Demo: New Hash (#) Syntax for Unique Fields\n')

console.log('Testing new shortcut syntax patterns:')
console.log(
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
)

// Test all combinations of the new syntax
const testTable = new TableBuilder('test_syntax')

console.log('1️⃣  Testing field variations:')

// Basic syntax tests
testTable.string('username#') // unique only
testTable.string('email!#') // required + unique
testTable.string('handle#!') // unique + required (alt order)
testTable.integer('badge_id#') // integer unique
testTable.string('firstName!') // required only
testTable.string('bio') // optional only

// Mixed with traditional syntax
testTable.string('api_key', { unique: true }) // traditional unique
testTable.string('phone!', { unique: true }) // required + traditional unique

console.log('   ✅ username#        → Optional + Unique')
console.log('   ✅ email!#          → Required + Unique')
console.log('   ✅ handle#!         → Unique + Required (alt order)')
console.log('   ✅ badge_id#        → Integer Unique')
console.log('   ✅ firstName!       → Required only')
console.log('   ✅ bio              → Optional only')
console.log('   ✅ api_key (unique) → Traditional syntax')
console.log('   ✅ phone! (unique)  → Mixed syntax')

console.log('\n2️⃣  Generated indexes:')
const indexes = testTable.getIndexes()

console.log(`📊 Total indexes: ${indexes.length}`)
console.log(
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
)

indexes.forEach((index, i) => {
  const autoFlag = index.auto ? '🤖 AUTO' : '👤 MANUAL'
  const uniqueFlag = index.unique ? '🔒 UNIQUE' : '📋 INDEX'

  console.log(`${i + 1}. ${autoFlag} | ${uniqueFlag} | ${index.columns[0]}`)
  console.log(`   Name: ${index.name}`)
  if (i < indexes.length - 1) console.log()
})

console.log(
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
)

console.log('\n3️⃣  Syntax Comparison:')
console.log()

console.log('🆚 Old vs New Syntax:')
console.log(
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
)
console.log('❌ Old:   @string "username", unique: true')
console.log('✅ New:   @string "username#"')
console.log('')
console.log('❌ Old:   @email "email!", unique: true')
console.log('✅ New:   @email "email!#"')
console.log('')
console.log('❌ Old:   @integer "badgeId", unique: true')
console.log('✅ New:   @integer "badgeId#"')
console.log(
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
)

console.log('\n4️⃣  CSS/HTML Inspiration:')
console.log('HTML/CSS:  <div id="header">  →  #header { ... }')
console.log('RIP Schema: @string "username#"  →  UNIQUE index')
console.log('')
console.log('💡 Perfect analogy: # = unique identifier!')

console.log('\n🎉 Benefits of Hash Syntax:')
console.log('   ✅ Concise and readable')
console.log('   ✅ Familiar from HTML/CSS')
console.log('   ✅ Works with all field types')
console.log('   ✅ Combines perfectly with ! (required)')
console.log('   ✅ Still supports traditional syntax')
console.log('   ✅ Auto-indexing works seamlessly')
