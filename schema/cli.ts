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
import { schema as schemaBuilder } from './schema-builder-v2'

// Parse command line arguments
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h' },
    schema: { type: 'string', short: 's', default: './db/schema.rip' },
    database: { type: 'string', short: 'd', default: './db/api.db' },
    verbose: { type: 'boolean', short: 'v' },
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

Options:
  -s, --schema PATH    Path to schema file (default: ./db/schema.rip)
  -d, --database PATH  Path to database file (default: ./db/api.db)
  -v, --verbose        Show detailed output
  -h, --help           Show this help message

Examples:
  rip-schema db:push
  rip-schema db:push -s ./schema.rip -d ./dev.db
  rip-schema db:drop
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
