/**
 * rip-schema Builder v2 - Flexible Parameter Support
 *
 * Supports both type-based and named parameters for maximum flexibility
 * Type-based params (numbers, arrays) can be in any order
 * Named params (key:value) must come last due to CoffeeScript/JS syntax
 */

import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  blob,
  InferInsertModel,
  InferSelectModel,
  integer,
  real,
  type SQLiteTableWithColumns,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

// Helper to parse parameters flexibly
type ColumnOptions = {
  size?: number
  precision?: number
  scale?: number
  default?: any
  unsigned?: boolean
  unique?: boolean
  references?: string
  onDelete?: 'cascade' | 'restrict' | 'set null'
  onUpdate?: 'cascade' | 'restrict' | 'set null'
}

// Column builder that wraps Drizzle columns
export class ColumnBuilder {
  private columns: Record<string, AnySQLiteColumn> = {}

  // Parse field notation: name! means required
  private parseField(name: string): { name: string; required: boolean } {
    const required = name.endsWith('!')
    return {
      name: required ? name.slice(0, -1) : name,
      required,
    }
  }

  // Parse default value from array notation or direct value
  private parseDefault(value: any): any {
    // Handle array notation
    if (Array.isArray(value) && value.length > 0) {
      const val = value[0]
      if (typeof val === 'function') {
        const expr = val()
        // Use sql.raw for SQL expressions
        return sql.raw(expr)
      }
      return val
    }
    // Handle function directly (for named params)
    else if (typeof value === 'function') {
      const expr = value()
      return sql.raw(expr)
    }
    return value
  }

    // Parse flexible parameters into options
  // Note: In CoffeeScript/JavaScript, named parameters (key:value) must come last
  private parseParams(...args: any[]): ColumnOptions {
    const options: ColumnOptions = {}
    
    for (const arg of args) {
      if (arg === null || arg === undefined) continue
      
      // Named parameters (object) - must be last in actual usage
      if (typeof arg === 'object' && !Array.isArray(arg)) {
        Object.assign(options, arg)
      }
      // Array = default value
      else if (Array.isArray(arg)) {
        options.default = this.parseDefault(arg)
      }
      // Number = size/precision (context-dependent)
      else if (typeof arg === 'number') {
        if (!options.size && !options.precision) {
          options.size = arg  // First number is size/precision
        } else if (!options.scale) {
          options.scale = arg  // Second number is scale (for decimals)
        }
      }
      // Boolean flags
      else if (typeof arg === 'boolean') {
        // Could be used for specific flags in the future
      }
    }
    
    return options
  }

  string(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    let column = text(name)
    if (required) column = column.notNull()
    if (options.default !== undefined) {
      column = column.default(options.default)
    }
    if (options.unique) {
      column = column.unique()
    }

    this.columns[name] = column as any
    return this
  }

  text(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    let column = text(name)
    if (required) column = column.notNull()
    if (options.default !== undefined) {
      column = column.default(options.default)
    }

    this.columns[name] = column as any
    return this
  }

  integer(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    let column = integer(name)
    if (required) column = column.notNull()
    if (options.default !== undefined) {
      column = column.default(options.default)
    }

    this.columns[name] = column as any
    return this
  }

  bigint(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    let column = integer(name)
    if (required) column = column.notNull()
    if (options.default !== undefined) {
      column = column.default(options.default)
    }

    this.columns[name] = column as any
    return this
  }

  boolean(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)

    // First check for direct boolean default
    let directDefault: boolean | undefined
    const otherArgs: any[] = []

    for (const arg of args) {
      if (typeof arg === 'boolean') {
        directDefault = arg
      } else {
        otherArgs.push(arg)
      }
    }

    const options = this.parseParams(...otherArgs)

    // SQLite uses integer for boolean
    let column = integer(name)
    if (required) column = column.notNull()

    // Use direct boolean if provided, otherwise check options
    const defaultValue = directDefault !== undefined ? directDefault : options.default
    if (defaultValue !== undefined) {
      // Convert boolean to integer
      const defaultVal = defaultValue === true ? 1 : defaultValue === false ? 0 : defaultValue
      column = column.default(defaultVal)
    }

    this.columns[name] = column as any
    return this
  }

  decimal(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    // SQLite uses REAL for decimals
    let column = real(name)
    if (required) column = column.notNull()
    if (options.default !== undefined) {
      column = column.default(options.default)
    }

    this.columns[name] = column as any
    return this
  }

  float(fieldName: string, ...args: any[]) {
    return this.decimal(fieldName, ...args)
  }

  datetime(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    let column = text(name)
    if (required) column = column.notNull()
    if (options.default !== undefined) {
      column = column.default(options.default)
    }

    this.columns[name] = column as any
    return this
  }

  date(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    let column = text(name)
    if (required) column = column.notNull()
    if (options.default !== undefined) {
      column = column.default(options.default)
    }

    this.columns[name] = column as any
    return this
  }

  time(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    let column = text(name)
    if (required) column = column.notNull()
    if (options.default !== undefined) {
      column = column.default(options.default)
    }

    this.columns[name] = column as any
    return this
  }

  timestamp(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    let column = text(name)
    if (required) column = column.notNull()
    if (options.default !== undefined) {
      column = column.default(options.default)
    }

    this.columns[name] = column as any
    return this
  }

  binary(fieldName: string, ...args: any[]) {
    const { name, required } = this.parseField(fieldName)
    const options = this.parseParams(...args)

    // In SQLite, we use blob for binary data
    let column = blob(name, { mode: 'buffer' })
    if (required) column = column.notNull()

    this.columns[name] = column as any
    return this
  }

  email(fieldName: string, ...args: any[]) {
    return this.string(fieldName, 255, ...args)
  }

  uuid(fieldName: string) {
    const { name, required } = this.parseField(fieldName)

    let column = text(name).default(sql`(lower(hex(randomblob(16))))`)
    if (required) column = column.notNull()

    this.columns[name] = column as any
    return this
  }

  timestamps() {
    this.datetime('created_at!', [() => "datetime('now')"])
    this.datetime('updated_at!', [() => "datetime('now')"])
    return this
  }

  // Relationships (for now just create the foreign key column)
  belongs_to(name: string, options?: { foreign_key?: string }) {
    const foreignKey = options?.foreign_key || `${name}_id`
    this.bigint(`${foreignKey}!`)
    return this
  }

  // Get the columns
  getColumns() {
    return this.columns
  }
}

// Table builder that uses the column builder
export class TableBuilder {
  private builder = new ColumnBuilder()
  public tableName: string

  constructor(tableName: string, options?: any) {
    this.tableName = tableName

    // Handle primary key
    const pk = options?.primary_key || 'id'
    const idType = options?.id ?? 'integer'

    if (idType !== false) {
      if (idType === 'uuid') {
        this.builder.uuid(pk)
      } else {
        this.builder.integer(pk).columns[pk] = integer(pk).primaryKey({
          autoIncrement: true,
        })
      }
    }

    // Auto-add timestamps if requested
    if (options?.timestamps !== false) {
      // We'll add these after user columns
    }
  }

  // Delegate all column methods to the builder
  string = this.builder.string.bind(this.builder)
  text = this.builder.text.bind(this.builder)
  integer = this.builder.integer.bind(this.builder)
  bigint = this.builder.bigint.bind(this.builder)
  boolean = this.builder.boolean.bind(this.builder)
  decimal = this.builder.decimal.bind(this.builder)
  float = this.builder.float.bind(this.builder)
  datetime = this.builder.datetime.bind(this.builder)
  date = this.builder.date.bind(this.builder)
  time = this.builder.time.bind(this.builder)
  timestamp = this.builder.timestamp.bind(this.builder)
  binary = this.builder.binary.bind(this.builder)
  email = this.builder.email.bind(this.builder)
  uuid = this.builder.uuid.bind(this.builder)
  timestamps = this.builder.timestamps.bind(this.builder)
  belongs_to = this.builder.belongs_to.bind(this.builder)

  // Index methods (stored for later use)
  index(...args: any[]) {
    // Store index info for migrations
    return this
  }

  soft_delete() {
    this.datetime('deleted_at')
    return this
  }

  // Build the actual Drizzle table
  build(): SQLiteTableWithColumns<any> {
    const columns = this.builder.getColumns()
    return sqliteTable(this.tableName, columns)
  }
}

// Main schema function
export function schema(callback: (this: any) => void) {
  const tables: Record<string, SQLiteTableWithColumns<any>> = {}

  const context = {
    table(name: string, ...args: any[]) {
      let options: any = {}
      let builderFn: Function | undefined

      // Parse arguments
      for (const arg of args) {
        if (typeof arg === 'function') {
          builderFn = arg
        } else if (typeof arg === 'object') {
          options = arg
        }
      }

      if (!builderFn) {
        throw new Error(`No builder function provided for table ${name}`)
      }

      const tableBuilder = new TableBuilder(name, options)
      builderFn.call(tableBuilder)

      // Add timestamps if not disabled
      if (options?.timestamps !== false && tableBuilder.tableName !== 'migrations') {
        tableBuilder.timestamps()
      }

      const table = tableBuilder.build()
      tables[name] = table
    },
  }

  callback.call(context)
  return tables
}

// Re-export types
export type { InferInsertModel, InferSelectModel }