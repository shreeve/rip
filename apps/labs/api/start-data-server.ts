#!/usr/bin/env bun

import { startRipDataServer } from '@rip/data'

console.log('🚀 Starting RipData Server for Labs API...')

const server = await startRipDataServer({
  dbPath: './db/api.db',
  protocols: {
    http: { port: 8306 },
    websocket: { port: 8307 }
  },
  maxConnections: 100
})

console.log('✅ RipData Server is running!')
console.log('📊 HTTP API: http://localhost:8306')
console.log('🔄 WebSocket: ws://localhost:8307')
console.log('💾 Database: ./db/labs.duckdb')

// Keep the server running
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down RipData Server...')
  await server.stop()
  process.exit(0)
})