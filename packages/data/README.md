# @rip/data - Revolutionary Data Platform

> **Transform your web application with DuckDB as both transactional AND analytical store**

## 🔥 The Major Shift

`@rip/data` represents a **paradigm shift** in web application architecture. Instead of the traditional pattern:

```
App → PostgreSQL (transactional) → ETL → Data Warehouse (analytical) → BI Tools
```

You get this elegant, unified architecture:

```
App → @rip/data (BOTH transactional AND analytical) → Direct Analytics
```

## ✨ Key Features

- **🎯 Single Source of Truth** - No data silos, no ETL delays
- **⚡ Real-time Analytics** - Query fresh data instantly
- **🔒 ACID Transactions** - Full transactional guarantees
- **📊 Columnar Performance** - Blazing fast analytical queries
- **🌊 Live Streaming** - WebSocket subscriptions for real-time updates
- **☁️ S3 Integration** - Seamless data lake connectivity
- **🔌 Multi-Protocol** - HTTP, WebSocket, PostgreSQL wire protocol
- **🚀 Bun-Powered** - Maximum performance with minimal overhead

## 🚀 Quick Start

### Installation

```bash
bun add @rip/data duckdb
```

### Start a Server

```typescript
import { RipDataServer } from '@rip/data'

const server = new RipDataServer({
  dbPath: './my-app.duckdb',
  protocols: {
    http: { port: 8080 },
    websocket: { port: 8081 }
  },
  s3: {
    bucket: 'my-data-lake',
    region: 'us-east-1'
  }
})

await server.start()
console.log('🔥 RipData server running!')
```

### Connect a Client

```typescript
import { RipDataClient } from '@rip/data'

const db = new RipDataClient('http://localhost:8080')

// Transactional operations
await db.execute(`
  INSERT INTO users (name, email) 
  VALUES (?, ?)
`, ['Alice', 'alice@example.com'])

// Analytical queries
const stats = await db.query(`
  SELECT 
    date_trunc('hour', created_at) as hour,
    count(*) as signups,
    avg(session_duration) as avg_session
  FROM users u
  JOIN sessions s ON u.id = s.user_id
  WHERE created_at > now() - interval '24 hours'
  GROUP BY hour
  ORDER BY hour
`)

console.log('📊 Hourly signups:', stats.data)
```

## 🎯 Core Concepts

### Single-Process Multi-Client Architecture

`@rip/data` solves DuckDB's single-writer limitation by creating a **Bun-powered server** that:

- Opens the DuckDB file **once** in a single process
- Handles **multiple concurrent clients** via HTTP/WebSocket
- Serializes **write operations** through a queue
- Allows **concurrent read operations** with multiple connections
- Provides **real-time streaming** via WebSocket subscriptions

### Write Queue with Batching

All write operations go through a high-performance queue:

```typescript
// These all get batched automatically
await Promise.all([
  db.execute('INSERT INTO users ...'),
  db.execute('UPDATE stats ...'),
  db.execute('INSERT INTO events ...')
])
```

### Real-Time Analytics

Subscribe to live query results:

```typescript
const unsubscribe = await db.subscribe(
  'SELECT COUNT(*) as active_users FROM sessions WHERE last_seen > now() - interval \'5 minutes\'',
  (data) => {
    console.log('Active users:', data[0].active_users)
  },
  1000 // Update every second
)
```

## 🌊 Advanced Features

### S3 Data Lake Integration

Query data directly from S3:

```typescript
// Query S3 data through DuckDB
const insights = await db.queryS3(
  'analytics-bucket',
  'events/*.parquet',
  `SELECT event_type, COUNT(*) 
   FROM 's3://analytics-bucket/events/*.parquet'
   WHERE date >= '2024-01-01'
   GROUP BY event_type`
)

// Hybrid queries: local + S3
const combined = await db.query(`
  SELECT 
    local.user_id,
    local.name,
    s3_events.event_count
  FROM users local
  JOIN (
    SELECT user_id, COUNT(*) as event_count
    FROM 's3://analytics/events/*.parquet'
    WHERE date >= '2024-01-01'
    GROUP BY user_id
  ) s3_events ON local.id = s3_events.user_id
`)
```

### Type-Safe Query Builder

```typescript
import { QueryBuilder } from '@rip/data'

const qb = new QueryBuilder(db)

const users = await qb
  .select('users')
  .select('id', 'name', 'email')
  .where('active = ? AND created_at > ?', true, '2024-01-01')
  .orderBy('created_at', 'DESC')
  .limit(100)
  .execute()
```

### Batch Transactions

```typescript
await db.batch([
  { sql: 'BEGIN TRANSACTION' },
  { sql: 'INSERT INTO users (name) VALUES (?)', params: ['Alice'] },
  { sql: 'INSERT INTO events (user_id, type) VALUES (?, ?)', params: [1, 'signup'] },
  { sql: 'UPDATE stats SET user_count = user_count + 1' },
  { sql: 'COMMIT' }
])
```

## 📊 Monitoring & Stats

Built-in monitoring and statistics:

```typescript
const health = await db.health()
console.log('Server status:', health.status)
console.log('Active connections:', health.connections)

const stats = await db.stats()
console.log('Query performance:', stats.stats)
```

## 🔌 Protocol Support

### HTTP API

Standard REST endpoints:

```bash
# Query data
curl -X POST http://localhost:8080/api/query \
  -d '{"sql": "SELECT * FROM users LIMIT 10"}'

# Execute writes  
curl -X POST http://localhost:8080/api/execute \
  -d '{"sql": "INSERT INTO users (name) VALUES (?)", "params": ["Bob"]}'

# Batch operations
curl -X POST http://localhost:8080/api/batch \
  -d '{"queries": [{"sql": "BEGIN"}, {"sql": "INSERT ..."}, {"sql": "COMMIT"}]}'
```

### WebSocket Streaming

```javascript
const ws = new WebSocket('ws://localhost:8081')

// Subscribe to live data
ws.send(JSON.stringify({
  type: 'subscribe',
  query: 'SELECT COUNT(*) FROM users',
  interval: 1000
}))

ws.onmessage = (event) => {
  const { data } = JSON.parse(event.data)
  console.log('Live user count:', data[0]['COUNT(*)'])
}
```

### PostgreSQL Wire Protocol (Coming Soon)

Connect with any PostgreSQL-compatible tool:

```bash
psql -h localhost -p 5432 -U admin -d ripdata
```

## 🏗️ Architecture Examples

### Micro-Service with Analytics

```typescript
import { Hono } from 'hono'
import { RipDataClient } from '@rip/data'

const app = new Hono()
const db = new RipDataClient('http://localhost:8080')

// Transactional endpoint
app.post('/api/users', async (c) => {
  const { name, email } = await c.req.json()
  
  const result = await db.execute(
    'INSERT INTO users (name, email) VALUES (?, ?) RETURNING id',
    [name, email]
  )
  
  return c.json({ id: result.data[0].id })
})

// Analytics endpoint
app.get('/api/analytics/users', async (c) => {
  const stats = await db.query(`
    SELECT 
      date_trunc('day', created_at) as date,
      count(*) as signups,
      count(DISTINCT email) as unique_emails
    FROM users
    WHERE created_at > now() - interval '30 days'
    GROUP BY date
    ORDER BY date
  `)
  
  return c.json(stats.data)
})
```

### Real-Time Dashboard

```typescript
import { RipDataClient } from '@rip/data'

const db = new RipDataClient('http://localhost:8080')
await db.connectWebSocket()

// Live metrics
const metrics = [
  'SELECT COUNT(*) as total_users FROM users',
  'SELECT COUNT(*) as active_sessions FROM sessions WHERE last_seen > now() - interval \'5 minutes\'',
  'SELECT SUM(amount) as revenue_today FROM orders WHERE created_at::date = current_date'
]

metrics.forEach((query, index) => {
  db.subscribe(query, (data) => {
    updateDashboard(`metric-${index}`, data[0])
  }, 2000)
})
```

## 🎯 Use Cases

### Perfect For:

- **📊 Real-time Analytics** - Live dashboards, monitoring
- **🔄 Event Sourcing** - Immutable event logs with analytics
- **📈 Business Intelligence** - Direct querying without ETL
- **🧪 Data Science** - Exploratory analysis on live data
- **📱 Modern Web Apps** - Rich analytics features
- **🏢 Internal Tools** - Admin dashboards, reporting

### Migration Path:

1. **Start Simple** - Replace your current database
2. **Add Analytics** - Query your transactional data directly  
3. **Scale Up** - Add S3 integration for historical data
4. **Go Real-Time** - Add WebSocket subscriptions
5. **Optimize** - Fine-tune performance and caching

## 🔧 Configuration

### Server Options

```typescript
const server = new RipDataServer({
  // Database file path
  dbPath: './my-app.duckdb',
  
  // Protocol configuration
  protocols: {
    http: { port: 8080 },
    websocket: { port: 8081 },
    postgres: { port: 5432 } // Coming soon
  },
  
  // S3 integration
  s3: {
    bucket: 'my-data-lake',
    region: 'us-east-1',
    endpoint: 'https://s3.amazonaws.com' // Optional
  },
  
  // Performance tuning
  maxConnections: 100,
  writeQueueSize: 1000
})
```

### Client Options

```typescript
const db = new RipDataClient({
  baseUrl: 'http://localhost:8080',
  timeout: 30000,
  retries: 3
})
```

## 🚀 Performance

### Benchmarks

- **🔥 Query Performance** - 10-100x faster than traditional OLTP databases for analytics
- **⚡ Write Throughput** - Batched writes achieve high throughput
- **📊 Compression** - Columnar storage reduces size by 10-100x
- **🌊 Streaming** - Real-time updates with minimal latency

### Optimization Tips

1. **Batch Writes** - Group related operations
2. **Use Indexes** - Create indexes on frequently queried columns
3. **Partition Data** - Use time-based partitioning for large datasets
4. **Leverage S3** - Move cold data to S3 for cost optimization
5. **Monitor Stats** - Use built-in monitoring to identify bottlenecks

## 🛣️ Roadmap

- **✅ HTTP API** - Complete REST interface
- **✅ WebSocket Streaming** - Real-time subscriptions  
- **✅ S3 Integration** - Data lake connectivity
- **🚧 PostgreSQL Wire Protocol** - Tool compatibility
- **🚧 Authentication** - JWT, API keys, role-based access
- **🚧 Clustering** - Multi-node deployments
- **🚧 Replication** - High availability setup
- **🚧 Extensions** - Plugin system for custom functionality

## 💡 Examples

Check out the `/examples` directory for complete applications:

- **Blog Analytics** - Real-time blog metrics
- **E-commerce Dashboard** - Sales analytics with live updates  
- **IoT Data Pipeline** - Sensor data ingestion and analysis
- **Social Media Analytics** - User engagement tracking

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🌟 Why @rip/data?

Traditional web applications are **data-poor** because analytics are **hard**. You have to:

- Set up separate analytical databases
- Build complex ETL pipelines  
- Deal with data consistency issues
- Manage multiple systems

**@rip/data changes everything:**

- **One database** for everything
- **Real-time analytics** out of the box
- **ACID consistency** for all operations
- **Massive cost savings** vs traditional stacks

**The result?** Web applications that are **data-rich** by default, with analytics as powerful as the biggest tech companies, but simple enough for any developer to use.

---

**Ready to revolutionize your data architecture?** 

```bash
bun add @rip/data
```

**The future of web applications is data-driven. The future is now.** 🔥