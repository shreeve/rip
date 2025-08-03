/**
 * ActiveRip Schema Builder v2 - Proper Drizzle Integration
 * 
 * This version actually generates real Drizzle table objects
 */

import { 
  sqliteTable, 
  text, 
  integer, 
  real,
  blob,
  AnySQLiteColumn,
  SQLiteTableWithColumns,
  InferSelectModel,
  InferInsertModel
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// Column builder that wraps Drizzle columns
export class ColumnBuilder {
  private columns: Record<string, AnySQLiteColumn> = {}
  
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
        if (expr === 'CURRENT_TIMESTAMP') {
          return sql`CURRENT_TIMESTAMP`
        }
        return sql.raw(expr)
      }
      return val
    }
    return value
  }
  
  string(fieldName: string, sizeOrDefault?: number | any[], defaultValue?: any[]) {
    const { name, required } = this.parseField(fieldName)
    
    let defVal: any
    
    // Handle overloads
    if (typeof sizeOrDefault === 'number') {
      defVal = defaultValue
    } else if (Array.isArray(sizeOrDefault)) {
      defVal = sizeOrDefault
    }
    
    let column = text(name)
    if (required) column = column.notNull()
    if (defVal !== undefined) {
      const parsed = this.parseDefault(defVal)
      if (parsed !== undefined) column = column.default(parsed)
    }
    
    this.columns[name] = column as any
    return this
  }
  
  text(fieldName: string, defaultValue?: any[]) {
    const { name, required } = this.parseField(fieldName)
    
    let column = text(name)
    if (required) column = column.notNull()
    if (defaultValue !== undefined) {
      const parsed = this.parseDefault(defaultValue)
      if (parsed !== undefined) column = column.default(parsed)
    }
    
    this.columns[name] = column as any
    return this
  }
  
  integer(fieldName: string, defaultValue?: any[]) {
    const { name, required } = this.parseField(fieldName)
    
    let column = integer(name)
    if (required) column = column.notNull()
    if (defaultValue !== undefined) {
      const parsed = this.parseDefault(defaultValue)
      if (parsed !== undefined) column = column.default(parsed)
    }
    
    this.columns[name] = column as any
    return this
  }
  
  bigint(fieldName: string, defaultValue?: any[]) {
    // SQLite doesn't have true bigint, use integer
    return this.integer(fieldName, defaultValue)
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
    
    this.columns[name] = column as any
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
    
    this.columns[name] = column as any
    return this
  }
  
  float(fieldName: string, defaultValue?: any[]) {
    return this.decimal(fieldName, undefined, undefined, defaultValue)
  }
  
  datetime(fieldName: string, defaultValue?: any[]) {
    const { name, required } = this.parseField(fieldName)
    
    let column = text(name)
    if (required) column = column.notNull()
    if (defaultValue !== undefined) {
      const parsed = this.parseDefault(defaultValue)
      if (parsed !== undefined) column = column.default(parsed)
    }
    
    this.columns[name] = column as any
    return this
  }
  
  email(fieldName: string, defaultValue?: any[]) {
    return this.string(fieldName, 255, defaultValue)
  }
  
  uuid(fieldName: string) {
    const { name, required } = this.parseField(fieldName)
    
    let column = text(name).default(sql`(lower(hex(randomblob(16))))`)
    if (required) column = column.notNull()
    
    this.columns[name] = column as any
    return this
  }
  
  timestamps() {
    this.datetime('created_at!', [() => 'CURRENT_TIMESTAMP'])
    this.datetime('updated_at!', [() => 'CURRENT_TIMESTAMP'])
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

// Table builder that creates actual Drizzle tables
export class TableBuilder {
  private builder = new ColumnBuilder()
  private tableName: string
  
  constructor(tableName: string, options?: any) {
    this.tableName = tableName
    
    // Handle primary key
    const pk = options?.primary_key || 'id'
    const idType = options?.id ?? 'integer'
    
    if (idType !== false) {
      if (idType === 'uuid') {
        this.builder.uuid(pk)
      } else {
        this.builder.integer(pk).columns[pk] = integer(pk).primaryKey({ autoIncrement: true })
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

// Schema class that manages tables
export class Schema {
  private tables: Record<string, SQLiteTableWithColumns<any>> = {}
  
  table(name: string, options?: any | ((this: TableBuilder) => void), builderFn?: (this: TableBuilder) => void) {
    let opts: any = {}
    let fn: ((this: TableBuilder) => void) | undefined
    
    if (typeof options === 'function') {
      fn = options
    } else {
      opts = options || {}
      fn = builderFn
    }
    
    const builder = new TableBuilder(name, opts)
    if (fn) {
      fn.call(builder)
    }
    
    this.tables[name] = builder.build()
    return this
  }
  
  getTables() {
    return this.tables
  }
}

// Main schema function
export function schema(builderFn: (this: Schema) => void): Record<string, SQLiteTableWithColumns<any>> {
  const s = new Schema()
  builderFn.call(s)
  return s.getTables()
}

// Make it globally available for Rip files
if (typeof global !== 'undefined') {
  (global as any).schema = schema
}