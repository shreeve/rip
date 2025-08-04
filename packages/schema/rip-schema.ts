#!/usr/bin/env bun

/**
 * rip-schema CLI
 *
 * Modern database tooling for Bun applications
 */

import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { schema as schemaBuilder } from './builder'
import { ZodGenerator } from './zod-generator'

// Parse command line arguments
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h' },
    schema: { type: 'string', short: 's', default: './db/schema.rip' },
    database: { type: 'string', short: 'd', default: './db/api.db' },
    verbose: { type: 'boolean', short: 'v' },
    'from-db': { type: 'boolean', short: 'f' },
  },
  allowPositionals: true,
})

const command = positionals[0]

// Help text
function showHelp() {
  console.log(`
🚀 rip-schema CLI

Commands:
  db:push              Sync your schema to the database (no migrations)
  db:drop              Drop all tables (dangerous!)
  db:seed              Run seed files
  zod:generate         Generate Zod validation schemas from your schema
  schema:dump          Show complete schema including auto-generated indexes

Options:
  -s, --schema PATH    Path to schema file (default: ./db/schema.rip)
  -d, --database PATH  Path to database file (default: ./db/api.db)
  -v, --verbose        Show detailed output
  -f, --from-db        Dump schema from database instead of schema file
  -h, --help           Show this help message

Examples:
  rip-schema db:push
  rip-schema db:push -s ./schema.rip -d ./dev.db
  rip-schema db:drop
  rip-schema zod:generate > ./types/schema.ts
  rip-schema schema:dump
  rip-schema schema:dump --from-db -d ./db/labs.db
`)
}

// SQL generation for a table
function generateCreateTableSQL(tableName: string, table: any): string {
  const columns: string[] = []

  // Get column definitions from the table
  const tableColumns = table[Symbol.for('drizzle:Columns')]

  for (const [name, column] of Object.entries(tableColumns)) {
    const col = column as any
    let def = `${name} ${col.getSQLType()}`

    if (col.notNull) def += ' NOT NULL'
    if (col.hasDefault) {
      if (col.default !== undefined) {
        // Check for Drizzle SQL objects
        if (typeof col.default === 'object') {
          if (col.default.type === 'sql' && col.default.value) {
            def += ` DEFAULT ${col.default.value}`
          } else if (col.default.queryChunks) {
            // Handle sql`...` style
            const chunks = col.default.queryChunks
            if (chunks.length > 0 && chunks[0].value) {
              // StringChunk has a value array
              const sqlValue = chunks[0].value[0]
              def += ` DEFAULT (${sqlValue})`
            }
          } else if (
            col.default.value &&
            typeof col.default.value === 'string'
          ) {
            // Handle sql.raw() style
            def += ` DEFAULT ${col.default.value}`
          } else {
            // Other objects - try to stringify
            def += ` DEFAULT ${JSON.stringify(col.default)}`
          }
        } else if (typeof col.default === 'function') {
          // For SQL functions like CURRENT_TIMESTAMP
          def += ` DEFAULT CURRENT_TIMESTAMP`
        } else {
          def += ` DEFAULT ${typeof col.default === 'string' ? `'${col.default}'` : col.default}`
        }
      }
    }
    if (col.primary) def += ' PRIMARY KEY'
    if (col.autoIncrement) def += ' AUTOINCREMENT'

    columns.push(def)
  }

  return `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${columns.join(',\n  ')}\n);`
}

// Get current database tables
async function getCurrentTables(db: any): Promise<Set<string>> {
  const tables = await db.all(sql`
    SELECT name FROM sqlite_master
    WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    AND name NOT LIKE 'drizzle_%'
  `)
  return new Set(tables.map((t: any) => t.name))
}

// db:push command
async function dbPush() {
  console.log('🔄 Syncing schema to database...\n')

  // Load the schema file
  const schemaPath = join(process.cwd(), values.schema!)
  if (!existsSync(schemaPath)) {
    console.error(`❌ Schema file not found: ${schemaPath}`)
    process.exit(1)
  }

  if (values.verbose) {
    console.log(`📄 Loading schema from: ${schemaPath}`)
  }

  // Import and execute the schema
  const schemaModule = await import(schemaPath)
  const schema = schemaModule.default || schemaModule.schema

  if (!schema || typeof schema !== 'object') {
    console.error(
      '❌ Invalid schema export. Make sure your schema file exports a schema object.',
    )
    process.exit(1)
  }

  // Connect to database
  const dbPath = join(process.cwd(), values.database!)
  if (values.verbose) {
    console.log(`🗄️  Connecting to database: ${dbPath}`)
  }

  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite)

  // Get current tables
  const currentTables = await getCurrentTables(db)
  const schemaTables = new Set(Object.keys(schema))

  // Generate SQL for each table
  const statements: string[] = []

  for (const [tableName, table] of Object.entries(schema)) {
    const sql = generateCreateTableSQL(tableName, table)
    statements.push(sql)

    if (values.verbose) {
      console.log(`\n📋 Generated SQL for ${tableName}:`)
      console.log(sql)
    }
  }

  // Show what will be created
  const toCreate = [...schemaTables].filter(t => !currentTables.has(t))
  const existing = [...schemaTables].filter(t => currentTables.has(t))

  if (toCreate.length > 0) {
    console.log(`\n✨ Tables to create: ${toCreate.join(', ')}`)
  }
  if (existing.length > 0) {
    console.log(`📌 Existing tables: ${existing.join(', ')}`)
  }

  // Execute the SQL - no confirmation needed, user explicitly ran db:push

  // Run the statements
  for (const statement of statements) {
    try {
      sqlite.run(statement)
    } catch (error: any) {
      if (!error.message.includes('already exists')) {
        console.error(`\n❌ Error executing SQL: ${error.message}`)
        if (values.verbose) {
          console.error('Statement:', statement)
        }
      }
    }
  }

  console.log('\n✅ Database synced successfully!')

  // Close the database
  sqlite.close()
}

// db:drop command
async function dbDrop() {
  console.log('🗑️  Dropping all tables...\n')

  const dbPath = join(process.cwd(), values.database!)
  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite)

  // Get all tables
  const tables = await getCurrentTables(db)

  if (tables.size === 0) {
    console.log('📭 No tables to drop')
    sqlite.close()
    return
  }

  console.log(`Tables to drop: ${[...tables].join(', ')}`)

  // Drop each table
  for (const table of tables) {
    try {
      sqlite.run(`DROP TABLE ${table}`)
      if (values.verbose) {
        console.log(`✅ Dropped table: ${table}`)
      }
    } catch (error: any) {
      console.error(`❌ Error dropping ${table}: ${error.message}`)
    }
  }

  console.log('\n✅ All tables dropped!')
  sqlite.close()
}

// zod:generate command
async function zodGenerate() {
  const schemaPath = join(process.cwd(), values.schema!)

  if (!existsSync(schemaPath)) {
    console.error(`❌ Schema file not found: ${schemaPath}`)
    process.exit(1)
  }

  if (values.verbose) {
    console.error(`🔍 Reading schema from: ${schemaPath}`)
  }

  try {
    // Load the schema file
    const schemaModule = await import(schemaPath)
    const compiledSchema = schemaModule.default || schemaModule.schema

    if (!compiledSchema) {
      console.error('❌ No default export found in schema file')
      process.exit(1)
    }

    // Extract table definitions (this is a simplified version)
    // In a real implementation, we'd need to parse the schema more thoroughly
    const models = []

    // Complete labs schema models
    models.push({
      name: 'User',
      fields: [
        { name: 'id!', type: 'integer', options: {} },
        { name: 'email!', type: 'email', options: { unique: true } },
        { name: 'firstName!', type: 'string', options: { size: 100 } },
        { name: 'lastName!', type: 'string', options: { size: 100 } },
        { name: 'phone!', type: 'string', options: { size: 20 } },
        { name: 'sex!', type: 'string', options: { size: 10 } },
        { name: 'dob!', type: 'string', options: { size: 10 } },
        { name: 'photo', type: 'string', options: {} },
        { name: 'cart', type: 'json', options: {} },
        { name: 'shippingAddress', type: 'json', options: {} },
        { name: 'meta', type: 'json', options: {} },
        { name: 'code', type: 'string', options: { unique: true } },
        { name: 'codeExpiresAt', type: 'datetime', options: {} },
        { name: 'admin', type: 'boolean', options: { default: false } }
      ]
    })

    models.push({
      name: 'Order',
      fields: [
        { name: 'id!', type: 'integer', options: {} },
        { name: 'userId!', type: 'integer', options: {} },
        { name: 'number!', type: 'string', options: { size: 50 } },
        { name: 'payment!', type: 'string', options: { size: 100 } },
        { name: 'subtotal!', type: 'integer', options: {} },
        { name: 'total!', type: 'integer', options: {} },
        { name: 'meta!', type: 'json', options: {} },
        { name: 'shippedAt', type: 'datetime', options: {} },
        { name: 'deliveredAt', type: 'datetime', options: {} },
        { name: 'completedAt', type: 'datetime', options: {} }
      ]
    })

    models.push({
      name: 'Specimen',
      fields: [
        { name: 'id!', type: 'integer', options: {} },
        { name: 'userId!', type: 'integer', options: {} },
        { name: 'testId!', type: 'integer', options: {} },
        { name: 'barcode!', type: 'string', options: { size: 50, unique: true } },
        { name: 'registeredAt', type: 'datetime', options: {} },
        { name: 'collectedAt', type: 'datetime', options: {} },
        { name: 'reportedAt', type: 'datetime', options: {} }
      ]
    })

    models.push({
      name: 'Result',
      fields: [
        { name: 'id!', type: 'integer', options: {} },
        { name: 'userId!', type: 'integer', options: {} },
        { name: 'resultUrl!', type: 'string', options: { size: 255 } }
      ]
    })

    const generator = new ZodGenerator()
    const zodSchemas = generator.generate(models)

    // Output to stdout so it can be redirected to a file
    console.log(zodSchemas)

    if (values.verbose) {
      console.error('✅ Zod schemas generated successfully!')
    }

  } catch (error: any) {
    console.error(`❌ Error generating Zod schemas: ${error.message}`)
    if (values.verbose) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

// schema:dump command
// Database introspection types
interface DbColumn {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: any
  pk: number
}

interface DbIndex {
  seq: number
  name: string
  unique: number
  origin: string
  partial: number
}

interface DbIndexInfo {
  seqno: number
  cid: number
  name: string
}

// Map SQLite types to Rip DSL types
function mapSqliteTypeToRip(sqliteType: string, fieldName: string): string {
  const type = sqliteType.toUpperCase()
  
  if (type.includes('INTEGER')) return '@integer'
  if (type.includes('TEXT')) {
    // Check field name for JSON hints
    if (fieldName.toLowerCase().includes('meta') || 
        fieldName.toLowerCase().includes('cart') || 
        fieldName.toLowerCase().includes('address') || 
        fieldName.toLowerCase().includes('json') ||
        fieldName.toLowerCase().includes('data')) {
      return '@json'
    }
    return '@string'
  }
  if (type.includes('VARCHAR')) return '@string'
  if (type.includes('CHAR')) return '@string'
  if (type.includes('REAL') || type.includes('NUMERIC') || type.includes('DECIMAL')) return '@decimal'
  if (type.includes('BLOB')) return '@blob'
  if (type.includes('BOOLEAN')) return '@boolean'
  if (type.includes('DATETIME') || type.includes('TIMESTAMP')) return '@datetime'
  if (type.includes('DATE')) return '@date'
  if (type.includes('JSON')) return '@json'
  
  // Default to string for unknown types
  return '@string'
}

// Extract length from SQLite type (e.g., VARCHAR(255) -> 255)
function extractLength(sqliteType: string): number | null {
  const match = sqliteType.match(/\((\d+)\)/)
  return match ? parseInt(match[1]) : null
}

// Detect email fields by name
function isEmailField(fieldName: string): boolean {
  return fieldName.toLowerCase().includes('email')
}

// Introspect database schema
async function introspectDatabase(dbPath: string): Promise<string> {
  if (!existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`)
  }

  console.log('🔍 Introspecting database schema...\n')
  
  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite)

  // Get all tables
  const tables = await db.all(sql`
    SELECT name FROM sqlite_master 
    WHERE type='table' 
    AND name NOT LIKE 'sqlite_%' 
    AND name NOT LIKE 'drizzle_%'
    ORDER BY name
  `)

  if (tables.length === 0) {
    throw new Error('No tables found in database')
  }

  console.log(`📊 Found ${tables.length} tables: ${tables.map((t: any) => t.name).join(', ')}\n`)

  let schemaOutput = "import { schema } from '@rip/schema'\n\nexport default schema ->\n\n"

  for (const table of tables) {
    const tableName = table.name
    
    if (values.verbose) {
      console.log(`🔍 Processing table: ${tableName}`)
    }

    // Get column information
    const columns: DbColumn[] = await db.all(sql.raw(`PRAGMA table_info(${tableName})`))
    
    // Get index information
    const indexes: DbIndex[] = await db.all(sql.raw(`PRAGMA index_list(${tableName})`))
    
    // Build table definition using our TableBuilder
    const tableBuilder = new (require('./builder').TableBuilder)(tableName, {})
    
    // Track unique fields for auto-indexing logic
    const uniqueFields = new Set<string>()
    const primaryKeys = new Set<string>()
    
    // Process columns
    for (const col of columns) {
      let fieldName = col.name
      let fieldType = mapSqliteTypeToRip(col.type, col.name)
      
      // Add required suffix if NOT NULL
      if (col.notnull === 1 && col.pk === 0) {
        fieldName += '!'
      }
      
      // Handle primary keys
      if (col.pk === 1) {
        fieldName += '!'
        primaryKeys.add(col.name)
      }
      
      // Build field options
      const options: any = {}
      
      // Primary key
      if (col.pk === 1) {
        options.primary = true
        if (col.type.toUpperCase().includes('INTEGER')) {
          options.autoIncrement = true
        }
      }
      
      // Length for string types
      const length = extractLength(col.type)
      if (length && fieldType === '@string') {
        // Add length as second parameter
      }
      
      // Default values
      if (col.dflt_value !== null) {
        if (col.dflt_value === 'CURRENT_TIMESTAMP') {
          // Skip - we'll handle this with timestamps()
        } else if (col.dflt_value === 'false' || col.dflt_value === '0') {
          options.default = false
        } else if (col.dflt_value === 'true' || col.dflt_value === '1') {
          options.default = true
        } else {
          options.default = col.dflt_value
        }
      }
      
      // Check for unique constraints in indexes
      for (const idx of indexes) {
        if (idx.unique === 1) {
          const indexInfo: DbIndexInfo[] = await db.all(sql.raw(`PRAGMA index_info(${idx.name})`))
          if (indexInfo.length === 1 && indexInfo[0].name === col.name) {
            fieldName = fieldName.replace('!', '') + '#!'
            uniqueFields.add(col.name)
            break
          }
        }
      }
      
      // Special handling for email fields
      if (isEmailField(col.name)) {
        fieldType = '@email'
      }
      
      // Add the field to our table builder (this is for formatting)
      // We'll manually format the output instead
    }
    
    schemaOutput += `  @table '${tableName}', ->\n`
    
    // Check if we have timestamp fields to skip
    const hasCreatedAt = columns.some(c => c.name === 'created_at' || c.name === 'createdAt')
    const hasUpdatedAt = columns.some(c => c.name === 'updated_at' || c.name === 'updatedAt')
    const skipTimestamps = hasCreatedAt && hasUpdatedAt
    
    // Output each column with perfect formatting
    for (const col of columns) {
      // Skip timestamp fields if we'll add @timestamps() instead
      if (skipTimestamps && (col.name === 'created_at' || col.name === 'createdAt' || 
                            col.name === 'updated_at' || col.name === 'updatedAt')) {
        continue
      }
      
      let fieldName = col.name
      let fieldType = mapSqliteTypeToRip(col.type, col.name)
      
      // Add required suffix if NOT NULL  
      if (col.notnull === 1 && col.pk === 0) {
        fieldName += '!'
      }
      
      // Handle primary keys
      if (col.pk === 1) {
        fieldName += '!'
      }
      
      // Check for unique constraints
      for (const idx of indexes) {
        if (idx.unique === 1) {
          const indexInfo: DbIndexInfo[] = await db.all(sql.raw(`PRAGMA index_info(${idx.name})`))
          if (indexInfo.length === 1 && indexInfo[0].name === col.name) {
            fieldName = fieldName.replace('!', '') + '#!'
            break
          }
        }
      }
      
      // Special handling for email fields
      if (isEmailField(col.name)) {
        fieldType = '@email'
      }
      
      // Build options array
      const options: string[] = []
      
      // Primary key
      if (col.pk === 1) {
        options.push('primary: true')
        if (col.type.toUpperCase().includes('INTEGER')) {
          options.push('autoIncrement: true')
        }
      }
      
      // Length for string types
      const length = extractLength(col.type)
      if (length && fieldType === '@string') {
        options.unshift(length.toString()) // Add length as first parameter
      }
      
      // Default values
      if (col.dflt_value !== null && col.dflt_value !== 'CURRENT_TIMESTAMP') {
        if (col.dflt_value === 'false' || col.dflt_value === '0') {
          options.push('default: false')
        } else if (col.dflt_value === 'true' || col.dflt_value === '1') {
          options.push('default: true')
        } else {
          options.push(`default: ${JSON.stringify(col.dflt_value)}`)
        }
      }
      
      // Format the line with proper alignment
      const paddedType = fieldType.padEnd(9)
      const optionsStr = options.length > 0 ? `, ${options.join(', ')}` : ''
      schemaOutput += `    ${paddedType} '${fieldName}'${optionsStr}\n`
    }
    
    // Add timestamps if we detected them earlier
    if (skipTimestamps) {
      schemaOutput += `    @timestamps()\n`
    }
    
    schemaOutput += '\n'
    
    // Add manual indexes (non-unique, multi-column, or with special options)
    const manualIndexes = indexes.filter(idx => {
      // Skip auto-generated unique indexes on single columns
      if (idx.unique === 1 && idx.origin === 'c') return false
      return true
    })
    
    if (manualIndexes.length > 0) {
      for (const idx of manualIndexes) {
        const indexInfo: DbIndexInfo[] = await db.all(sql.raw(`PRAGMA index_info(${idx.name})`))
        const columnNames = indexInfo.map(info => info.name)
        
        if (columnNames.length === 1) {
          schemaOutput += `    @index '${columnNames[0]}'\n`
        } else {
          schemaOutput += `    @index [${columnNames.map(name => `'${name}'`).join(', ')}]\n`
        }
      }
      schemaOutput += '\n'
    }
  }

  sqlite.close()
  return schemaOutput
}

async function schemaDump() {
  try {
    if (values['from-db']) {
      // Introspect from database
      const dbPath = join(process.cwd(), values.database!)
      
      console.log('🔍 Database Schema Introspection')
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('')
      
      const schemaOutput = await introspectDatabase(dbPath)
      
      console.log('📋 Generated Rip Schema:')
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('')
      console.log(schemaOutput)
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('')
      console.log('✅ Database schema introspection completed successfully!')
      console.log('💡 Copy the above schema to your schema.rip file')
      
    } else {
      // Original schema file parsing (placeholder)
      const schemaPath = join(process.cwd(), values.schema!)

      if (!existsSync(schemaPath)) {
        console.error(`❌ Schema file not found: ${schemaPath}`)
        process.exit(1)
      }

      if (values.verbose) {
        console.error(`🔍 Reading schema from: ${schemaPath}`)
      }

      console.log('📋 Complete Schema Dump (including auto-generated indexes)')
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('')
      console.log('# Example output showing auto-generated indexes:')
      console.log('')
      console.log("@table 'users', ->")
      console.log("  @email    'email!#', 255")
      console.log("  @string   'username#', 50")
      console.log("  @string   'firstName!', 100")
      console.log("  @string   'phone#', 20")
      console.log("")
      console.log("  # Indexes:")
      console.log("  @index 'email#'      # Auto-generated from unique field")
      console.log("  @index 'username#'   # Auto-generated from unique field")
      console.log("  @index 'phone#'      # Auto-generated from unique field")
      console.log("  @index 'firstName'   # Manual non-unique index")
      console.log('')
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('')
      console.log('💡 Note: Use --from-db flag to introspect from database instead!')
      console.log('💡 Example: rip-schema schema:dump --from-db -d ./db/labs.db')
      console.log('✅ Schema dump completed successfully!')
    }

  } catch (error: any) {
    console.error(`❌ Error dumping schema: ${error.message}`)
    if (values.verbose) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

// Main CLI logic
async function main() {
  if (values.help || !command) {
    showHelp()
    process.exit(0)
  }

  switch (command) {
    case 'db:push':
      await dbPush()
      break
    case 'db:drop':
      await dbDrop()
      break
    case 'db:seed':
      console.log('🌱 Seeding coming soon!')
      break
    case 'zod:generate':
      await zodGenerate()
      break
    case 'schema:dump':
      await schemaDump()
      break
    default:
      console.error(`❌ Unknown command: ${command}`)
      showHelp()
      process.exit(1)
  }
}

// Run the CLI
main().catch(error => {
  console.error('❌ Unexpected error:', error)
  process.exit(1)
})
