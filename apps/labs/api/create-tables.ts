#!/usr/bin/env bun

import { RipDataClient } from '@rip/data'

const client = new RipDataClient('http://localhost:8306')

console.log('🏗️  Creating tables in DuckDB...')

try {
  // Create users table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email VARCHAR UNIQUE NOT NULL,
      firstName VARCHAR NOT NULL,
      lastName VARCHAR NOT NULL,
      phone VARCHAR NOT NULL,
      sex VARCHAR NOT NULL,
      dob VARCHAR NOT NULL,
      photo VARCHAR,
      cart JSON,
      shippingAddress JSON,
      meta JSON,
      code VARCHAR UNIQUE,
      codeExpiresAt TIMESTAMP,
      admin BOOLEAN DEFAULT false,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  console.log('✅ Created users table')

  // Create orders table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      userId INTEGER NOT NULL,
      number VARCHAR UNIQUE NOT NULL,
      payment VARCHAR NOT NULL,
      subtotal INTEGER NOT NULL,
      total INTEGER NOT NULL,
      meta JSON NOT NULL,
      shippedAt TIMESTAMP,
      deliveredAt TIMESTAMP,
      completedAt TIMESTAMP,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  console.log('✅ Created orders table')

  // Create specimens table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS specimens (
      id INTEGER PRIMARY KEY,
      userId INTEGER NOT NULL,
      testId INTEGER NOT NULL,
      barcode VARCHAR UNIQUE NOT NULL,
      registeredAt TIMESTAMP,
      collectedAt TIMESTAMP,
      reportedAt TIMESTAMP,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  console.log('✅ Created specimens table')

  // Create results table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY,
      userId INTEGER NOT NULL,
      resultUrl VARCHAR NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
  console.log('✅ Created results table')

  console.log('🎉 All tables created successfully!')

} catch (error) {
  console.error('❌ Error creating tables:', error)
  process.exit(1)
}