import { Database } from 'bun:sqlite'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import schema from './schema.rip'

// Get the directory of this file
const __dirname = dirname(fileURLToPath(import.meta.url))

// Create SQLite database in the db directory
const dbPath = join(__dirname, 'api.db')
const sqlite = new Database(dbPath)

// Create Drizzle instance with our rip-schema
export const db = drizzle(sqlite, { schema })

// Export the lawfirms table from our rip-schema
export const lawfirmsTable = schema.lawfirms

// Initialize the database table
// Note: In production, you'd use proper migrations
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
    fax TEXT,
    website TEXT,
    notes TEXT,
    active INTEGER DEFAULT 1,
    hourly_rate REAL,
    employee_count INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`)
