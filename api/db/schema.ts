import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Get the directory of this file
const __dirname = dirname(fileURLToPath(import.meta.url))

// Create SQLite database in the db directory
const dbPath = join(__dirname, 'api.db')
const sqlite = new Database(dbPath)
export const db = drizzle(sqlite)

// Define the lawfirms table
export const lawfirmsTable = sqliteTable('lawfirms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
})

// Initialize the database table
sqlite.run(`
  CREATE TABLE IF NOT EXISTS lawfirms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`)