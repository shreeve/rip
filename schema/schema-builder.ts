/**
 * Rip Schema - A beautiful schema DSL for Drizzle
 *
 * Inspired by ActiveRecord but designed for modern TypeScript/Bun apps
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  primaryKey,
  index,
  uniqueIndex,
  foreignKey,
  AnySQLiteTable
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'

// Types
type ColumnOptions = {
  unsigned?: boolean
  unique?: boolean
  references?: string  // foreign key reference
  onDelete?: 'cascade' | 'restrict' | 'set null'
  onUpdate?: 'cascade' | 'restrict' | 'set null'
}

type IndexOptions = {
  name?: string
  unique?: boolean
  where?: string  // partial index
}

type TableOptions = {
  primary_key?: string | string[]
  id?: 'bigint' | 'integer' | 'uuid' | false
  timestamps?: boolean
  soft_delete?: boolean
}

// Table Builder
export class RipTableBuilder {
  private columns: Record<string, any> = {}
  private indexes: Array<{ columns: string[], options?: IndexOptions }> = []
  private foreignKeys: Array<any> = []
  private checks: Array<{ name?: string, sql: string }> = []

  constructor(
    private tableName: string,
    private options: TableOptions = {}
  ) {
    // Handle primary key
    const pk = options.primary_key || 'id'
    const idType = options.id ?? 'bigint'

    if (idType !== false) {
      if (typeof pk === 'string') {
        if (idType === 'uuid') {
          this.columns[pk] = text(pk).primaryKey().default(sql`(lower(hex(randomblob(16))))`)
        } else {
          this.columns[pk] = integer(pk).primaryKey({ autoIncrement: true })
        }
      }
    }

    // Auto-add timestamps if requested
    if (options.timestamps !== false) {
      // Most schemas want timestamps by default
      this.timestamps()
    }
  }

  // Parse field notation: name! means required
  private parseField(name: string): { name: string, required: boolean } {
    const required = name.endsWith('!')
    return {
      name: required ? name.slice(0, -1) : name,
      required
    }
  }

  // Parse default value from array notation
  private parseDefault(value: any): any {
    if (Array.isArray(value) && value.length > 0) {
      const val = value[0]
      if (typeof val === 'function') {
        const expr = val()
        if (expr.includes('CURRENT_TIMESTAMP')) {
          return sql`CURRENT_TIMESTAMP`
        }
        return sql.raw(expr)
      }
      return val
    }
    return value
  }

  // Column types
  string(fieldName: string, sizeOrDefault?: number | any[], defaultValue?: any[], options?: ColumnOptions) {
    const { name, required } = this.parseField(fieldName)

    let size: number | undefined
    let defVal: any
    let opts = options

    // Overload handling
    if (typeof sizeOrDefault === 'number') {
      size = sizeOrDefault
      defVal = defaultValue
    } else if (Array.isArray(sizeOrDefault)) {
      defVal = sizeOrDefault
    } else if (typeof sizeOrDefault === 'object') {
      opts = sizeOrDefault
    }

    let column = text(name)
    if (required) column = column.notNull()
    if (defVal !== undefined) {
      const parsed = this.parseDefault(defVal)
      if (parsed !== undefined) column = column.default(parsed)
    }
    if (opts?.unique) column = column.unique()

    this.columns[name] = column

    // Handle foreign key
    if (opts?.references) {
      this.references(name, opts.references, opts)
    }

    return this
  }

  text(fieldName: string, defaultValue?: any[], options?: ColumnOptions) {
    const { name, required } = this.parseField(fieldName)

    let column = text(name)
    if (required) column = column.notNull()
    if (defaultValue !== undefined) {
      const parsed = this.parseDefault(defaultValue)
      if (parsed !== undefined) column = column.default(parsed)
    }

    this.columns[name] = column
    return this
  }

  integer(fieldName: string, sizeOrDefault?: number | any[], defaultValue?: any[], options?: ColumnOptions) {
    const { name, required } = this.parseField(fieldName)

    let defVal: any
    let opts = options

    if (typeof sizeOrDefault === 'number') {
      // Size is ignored in SQLite but kept for compatibility
      defVal = defaultValue
    } else if (Array.isArray(sizeOrDefault)) {
      defVal = sizeOrDefault
    } else if (typeof sizeOrDefault === 'object') {
      opts = sizeOrDefault
    }

    let column = integer(name)
    if (required) column = column.notNull()
    if (defVal !== undefined) {
      const parsed = this.parseDefault(defVal)
      if (parsed !== undefined) column = column.default(parsed)
    }

    this.columns[name] = column
    return this
  }

  bigint(fieldName: string, defaultValue?: any[], options?: ColumnOptions) {
    // In SQLite, bigint is just integer
    return this.integer(fieldName, defaultValue, undefined, options)
  }

  boolean(fieldName: string, defaultValue?: boolean | any[]) {
    const { name, required } = this.parseField(fieldName)

    let column = integer(name, { mode: 'boolean' })
    if (required) column = column.notNull()

    if (defaultValue !== undefined) {
      if (typeof defaultValue === 'boolean') {
        column = column.default(defaultValue)
      } else if (Array.isArray(defaultValue)) {
        const parsed = this.parseDefault(defaultValue)
        if (parsed !== undefined) column = column.default(parsed)
      }
    }

    this.columns[name] = column
    return this
  }

  decimal(fieldName: string, precision?: number, scale?: number, defaultValue?: any[]) {
    const { name, required } = this.parseField(fieldName)

    let column = real(name)
    if (required) column = column.notNull()
    if (defaultValue !== undefined) {
      const parsed = this.parseDefault(defaultValue)
      if (parsed !== undefined) column = column.default(parsed)
    }

    this.columns[name] = column
    return this
  }

  float(fieldName: string, defaultValue?: any[]) {
    return this.decimal(fieldName, undefined, undefined, defaultValue)
  }

  date(fieldName: string, defaultValue?: any[]) {
    const { name, required } = this.parseField(fieldName)

    let column = text(name)  // SQLite stores dates as text
    if (required) column = column.notNull()
    if (defaultValue !== undefined) {
      const parsed = this.parseDefault(defaultValue)
      if (parsed !== undefined) column = column.default(parsed)
    }

    this.columns[name] = column
    return this
  }

  datetime(fieldName: string, defaultValue?: any[]) {
    return this.date(fieldName, defaultValue)
  }

  timestamp(fieldName: string, defaultValue?: any[]) {
    return this.datetime(fieldName, defaultValue)
  }

  json(fieldName: string, defaultValue?: any) {
    const { name, required } = this.parseField(fieldName)

    let column = text(name, { mode: 'json' })
    if (required) column = column.notNull()
    if (defaultValue !== undefined) {
      column = column.default(defaultValue)
    }

    this.columns[name] = column
    return this
  }

  binary(fieldName: string) {
    const { name, required } = this.parseField(fieldName)

    let column = blob(name, { mode: 'buffer' })
    if (required) column = column.notNull()

    this.columns[name] = column
    return this
  }

  // Special column types
  email(fieldName: string, defaultValue?: any[]) {
    this.string(fieldName, 255, defaultValue)
    // Could add check constraint for email format
    return this
  }

  uuid(fieldName: string) {
    const { name, required } = this.parseField(fieldName)

    let column = text(name).default(sql`(lower(hex(randomblob(16))))`)
    if (required) column = column.notNull()

    this.columns[name] = column
    return this
  }

  // Relationships
  references(column: string, foreignTable: string, options?: Partial<ColumnOptions>) {
    // Store foreign key info for later processing
    this.foreignKeys.push({
      column,
      foreignTable,
      foreignColumn: options?.references || 'id',
      onDelete: options?.onDelete,
      onUpdate: options?.onUpdate
    })
    return this
  }

  belongs_to(name: string, options?: { class_name?: string, foreign_key?: string }) {
    const foreignKey = options?.foreign_key || `${name}_id`
    const tableName = options?.class_name || `${name}s`

    this.bigint(`${foreignKey}!`)
    this.references(foreignKey, tableName)
    this.index(foreignKey)

    return this
  }

  // Timestamps
  timestamps() {
    this.datetime('created_at!', [() => 'CURRENT_TIMESTAMP'])
    this.datetime('updated_at!', [() => 'CURRENT_TIMESTAMP'])
    return this
  }

  // Soft deletes
  soft_delete() {
    this.datetime('deleted_at')
    this.index('deleted_at')
    return this
  }

  // Indexes
  index(columns: string | string[], options?: IndexOptions) {
    const cols = Array.isArray(columns) ? columns : [columns]
    this.indexes.push({ columns: cols, options })
    return this
  }

  // Constraints
  check(sql: string, name?: string) {
    this.checks.push({ sql, name })
    return this
  }

  // Build the table
  build() {
    // Create the basic table
    const table = sqliteTable(this.tableName, this.columns)

    // Note: In a real implementation, you'd also generate:
    // - Index creation statements
    // - Foreign key constraints
    // - Check constraints
    // These would be returned as additional SQL statements

    return {
      table,
      indexes: this.indexes,
      foreignKeys: this.foreignKeys,
      checks: this.checks
    }
  }
}

// Schema Builder
export class RipSchema {
  public tables: Record<string, any> = {}
  private tableBuilders: Record<string, RipTableBuilder> = {}

  table(name: string, options?: TableOptions | ((this: RipTableBuilder) => void), builder?: (this: RipTableBuilder) => void) {
    let opts: TableOptions = {}
    let builderFn: ((this: RipTableBuilder) => void) | undefined

    if (typeof options === 'function') {
      builderFn = options
    } else {
      opts = options || {}
      builderFn = builder
    }

    const tb = new RipTableBuilder(name, opts)
    if (builderFn) {
      builderFn.call(tb)
    }

    const result = tb.build()
    this.tables[name] = result.table
    this.tableBuilders[name] = tb

    return this
  }

  // Get all tables
  getTables() {
    return this.tables
  }

  // Generate migration SQL (future feature)
  generateSQL() {
    // Would generate CREATE TABLE, CREATE INDEX, etc.
    return []
  }
}

// Global schema function
export function schema(builder: (this: RipSchema) => void): Record<string, any> {
  const s = new RipSchema()
  builder.call(s)
  return s.getTables()
}

// Make it available globally in Rip files
if (typeof global !== 'undefined') {
  (global as any).schema = schema
}