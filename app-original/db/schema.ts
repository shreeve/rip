import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'

const sqlite = new Database('db.sqlite')
export const db = drizzle(sqlite)

export const lawfirmsTable = sqliteTable('lawfirms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})
