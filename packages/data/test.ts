import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { RipDataServer, RipDataClient } from './index'

describe('@rip/data', () => {
  let server: RipDataServer
  let client: RipDataClient

  beforeAll(async () => {
    // Start server with in-memory database for testing
    server = new RipDataServer({
      dbPath: ':memory:',
      protocols: {
        http: { port: 8082 }, // Different port to avoid conflicts
        websocket: { port: 8083 }
      }
    })

    await server.start()
    client = new RipDataClient('http://localhost:8082')
  })

  afterAll(async () => {
    await server.stop()
  })

  it('should create tables and insert data', async () => {
    // Create test table
    const createResult = await client.execute(`
      CREATE TABLE test_users (
        id INTEGER PRIMARY KEY,
        name VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    expect(createResult.success).toBe(true)

    // Insert test data
    const insertResult = await client.execute(
      'INSERT INTO test_users (name) VALUES (?)',
      ['Test User']
    )

    expect(insertResult.success).toBe(true)
  })

  it('should query data', async () => {
    const result = await client.query('SELECT * FROM test_users')

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data!.length).toBe(1)
    expect(result.data![0].name).toBe('Test User')
  })

  it('should handle batch operations', async () => {
    const result = await client.batch([
      { sql: 'BEGIN TRANSACTION' },
      { sql: 'INSERT INTO test_users (name) VALUES (?)', params: ['Batch User 1'] },
      { sql: 'INSERT INTO test_users (name) VALUES (?)', params: ['Batch User 2'] },
      { sql: 'COMMIT' }
    ])

    expect(result.success).toBe(true)

    // Verify batch insert worked
    const queryResult = await client.query('SELECT COUNT(*) as count FROM test_users')
    expect(queryResult.data![0].count).toBe(3)
  })

  it('should provide server stats', async () => {
    const stats = await client.stats()

    expect(stats.success).toBe(true)
    expect(stats.activeConnections).toBeDefined()
    expect(stats.writeQueueSize).toBeDefined()
  })

  it('should check server health', async () => {
    const health = await client.health()

    expect(health.status).toBe('healthy')
    expect(health.timestamp).toBeDefined()
    expect(health.connections).toBeDefined()
  })

  it('should handle WebSocket connections', async () => {
    const ws = await client.connectWebSocket()

    expect(ws.readyState).toBe(WebSocket.OPEN)

    client.disconnect()
  })

  it('should handle errors gracefully', async () => {
    const result = await client.query('SELECT * FROM nonexistent_table')

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should support analytical queries', async () => {
    // Insert more test data
    await client.execute('INSERT INTO test_users (name) VALUES (?)', ['Analytics User 1'])
    await client.execute('INSERT INTO test_users (name) VALUES (?)', ['Analytics User 2'])

    // Run analytical query
    const result = await client.query(`
      SELECT
        COUNT(*) as total_users,
        COUNT(CASE WHEN name LIKE 'Analytics%' THEN 1 END) as analytics_users
      FROM test_users
    `)

    expect(result.success).toBe(true)
    expect(result.data![0].total_users).toBe(5)
    expect(result.data![0].analytics_users).toBe(2)
  })
})