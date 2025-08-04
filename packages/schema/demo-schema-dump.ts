#!/usr/bin/env bun

/**
 * Demo: Schema Dumping - Show complete schema including auto-generated indexes
 * This demonstrates schema transparency and introspection capabilities
 */

import { TableBuilder } from './builder'

console.log('📋 Demo: Schema Dumping - Complete Transparency\n')

console.log('🎯 Creating schema with mixed manual and auto-generated indexes...')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

// Create a realistic table schema
const userTable = new TableBuilder('users')

// Add fields with mixed indexing scenarios
userTable.string('email!', { unique: true })                    // Will auto-generate unique index
userTable.string('username!', { unique: true })                 // Will auto-generate unique index
userTable.string('firstName!', 100)                             // Required but not unique
userTable.string('lastName!', 100)                              // Required but not unique
userTable.string('phone!', 20, { unique: true })                // Will auto-generate unique index
userTable.text('bio')                                           // Optional field
userTable.integer('external_id', { unique: true })              // Will auto-generate unique index

// Add some manual indexes
userTable.index('firstName')                                     // Manual non-unique index
userTable.index('lastName')                                      // Manual non-unique index
userTable.index(['firstName', 'lastName'])                       // Compound index
userTable.index('email', { unique: true })                      // Explicit unique (matches auto)
userTable.index('username', { unique: true, partial: 'substr(username, 1, 10)' }) // Custom partial index

console.log('\n1️⃣  Original Schema Definition:')
console.log('```coffeescript')
console.log("@table 'users', ->")
console.log("  @string 'email!', unique: true")
console.log("  @string 'username!', unique: true")
console.log("  @string 'firstName!', 100")
console.log("  @string 'lastName!', 100")
console.log("  @string 'phone!', 20, unique: true")
console.log("  @text   'bio'")
console.log("  @integer 'external_id', unique: true")
console.log("")
console.log("  # Manual indexes")
console.log("  @index 'firstName'")
console.log("  @index 'lastName'")
console.log("  @index ['firstName', 'lastName']")
console.log("  @index 'email', unique: true")
console.log("  @index 'username', unique: true, partial: 'substr(username, 1, 10)'")
console.log('```')

console.log('\n2️⃣  Complete Dumped Schema (including auto-generated):')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('```coffeescript')
console.log(userTable.dumpSchema())
console.log('```')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

console.log('\n3️⃣  Index Analysis:')
const allIndexes = userTable.getIndexes()

console.log(`\n📊 Total indexes: ${allIndexes.length}`)

// Group by type
const autoIndexes = allIndexes.filter(idx => idx.auto)
const manualIndexes = allIndexes.filter(idx => !idx.auto)

console.log(`   🤖 Auto-generated: ${autoIndexes.length}`)
console.log(`   👤 Manual: ${manualIndexes.length}`)

console.log('\n🤖 Auto-Generated Indexes:')
autoIndexes.forEach(idx => {
  console.log(`   • ${idx.columns.join(', ')} (${idx.unique ? 'unique' : 'index'})`)
})

console.log('\n👤 Manual Indexes:')
manualIndexes.forEach(idx => {
  const options = []
  if (idx.unique) options.push('unique')
  if (idx.options?.partial) options.push(`partial: ${idx.options.partial}`)
  if (idx.options?.where) options.push(`where: ${idx.options.where}`)

  const optionStr = options.length > 0 ? ` (${options.join(', ')})` : ''
  console.log(`   • ${idx.columns.join(', ')}${optionStr}`)
})

console.log('\n💡 Key Benefits of Schema Dumping:')
console.log('   ✅ Complete transparency - see ALL indexes')
console.log('   ✅ Auto-generated indexes are clearly marked')
console.log('   ✅ Perfect for documentation generation')
console.log('   ✅ Great for schema comparison and migrations')
console.log('   ✅ Helps with performance debugging')
console.log('   ✅ Makes implicit behavior explicit')

console.log('\n🚀 Use Cases:')
console.log('   • Schema documentation generation')
console.log('   • Database migration planning')
console.log('   • Performance analysis')
console.log('   • Team onboarding and code reviews')
console.log('   • Schema comparison between environments')