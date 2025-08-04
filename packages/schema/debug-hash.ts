#!/usr/bin/env bun

import { TableBuilder } from './builder'

console.log('🔍 Debugging Hash Syntax')

const table = new TableBuilder('debug')
console.log('Adding field: email!#')
table.string('email!#')

console.log('Unique fields:', Array.from(table['builder'].getUniqueFields()))

const indexes = table.getIndexes()
console.log('Indexes:', indexes.map(idx => ({
  name: idx.name,
  columns: idx.columns,
  auto: idx.auto,
  unique: idx.unique
})))