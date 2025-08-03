// Test SQL generation for flexible params
const schemaModule = await import('./test-flexible-params.rip')
const schema = schemaModule.default

console.log('Testing flexible parameter syntax SQL generation:\n')

for (const [tableName, table] of Object.entries(schema)) {
  const columns: string[] = []
  const tableColumns = (table as any)[Symbol.for('drizzle:Columns')]

  for (const [name, column] of Object.entries(tableColumns)) {
    const col = column as any
    let def = `  ${name} ${col.getSQLType()}`

    if (col.notNull) def += ' NOT NULL'
    if (col.hasDefault) {
      if (col.default !== undefined) {
        if (typeof col.default === 'object' && col.default.queryChunks) {
          const chunks = col.default.queryChunks
          if (chunks.length > 0 && chunks[0].value) {
            const sqlValue = chunks[0].value[0]
            def += ` DEFAULT (${sqlValue})`
          }
        } else {
          def += ` DEFAULT ${JSON.stringify(col.default)}`
        }
      }
    }

    if (col.primary) def += ' PRIMARY KEY'
    if (col.autoIncrement) def += ' AUTOINCREMENT'

    columns.push(def)
  }

  console.log(`CREATE TABLE ${tableName} (`)
  console.log(columns.join(',\n'))
  console.log(');\n')
}