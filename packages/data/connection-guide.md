# 🔥 RipData Server - Complete Connection Guide

**Every way to START and CONNECT to your DuckDB server**

## 🚀 1. Starting the Server

### **Method 1: Via Labs API (Recommended)**
```bash
cd apps/labs/api
bun run data:start  # Starts rip-data-server.rip on port 8306
```

### **Method 2: Direct Execution**
```bash
cd apps/labs/api
bun rip-data-server.rip
```

### **Method 3: Custom Configuration**
```rip
# Create custom-data-server.rip
import { RipDataServer } from '@rip/data'

server = new RipDataServer
  dbPath: './my-custom.duckdb'
  protocols:
    http: { port: 9000 }
    websocket: { port: 9001 }
    postgres: { port: 5432 }  # PostgreSQL wire protocol
  enableS3: true
  maxConnections: 500

server.start!
```

## 🔌 2. Connection Protocols

### **HTTP/REST API** (Port 8306 by default)

**Basic queries:**
```bash
# Query data
curl -X POST http://localhost:8306/api/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM users LIMIT 5"}'

# Execute writes
curl -X POST http://localhost:8306/api/execute \
  -H "Content-Type: application/json" \
  -d '{"sql": "INSERT INTO users (email, firstName) VALUES (?, ?)", "params": ["test@example.com", "John"]}'

# Batch operations
curl -X POST http://localhost:8306/api/batch \
  -H "Content-Type: application/json" \
  -d '{"queries": [
    {"sql": "BEGIN"},
    {"sql": "INSERT INTO users (email, firstName) VALUES (?, ?)", "params": ["batch@example.com", "Batch"]},
    {"sql": "COMMIT"}
  ]}'

# Health check
curl http://localhost:8306/health

# Server stats
curl http://localhost:8306/stats
```

### **WebSocket Streaming** (Port 8307 by default)

**JavaScript/Browser:**
```javascript
const ws = new WebSocket('ws://localhost:8307')

// Subscribe to live data
ws.send(JSON.stringify({
  type: 'subscribe',
  query: 'SELECT COUNT(*) as user_count FROM users',
  interval: 1000  // Update every second
}))

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  console.log('Live user count:', message.data[0].user_count)
}
```

**Node.js:**
```javascript
import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:8307')

ws.on('open', () => {
  // Real-time order monitoring
  ws.send(JSON.stringify({
    type: 'subscribe',
    query: `
      SELECT 
        COUNT(*) as total_orders,
        SUM(total) as revenue_today
      FROM orders 
      WHERE DATE(createdAt) = CURRENT_DATE
    `,
    interval: 5000
  }))
})

ws.on('message', (data) => {
  const { data: results } = JSON.parse(data.toString())
  console.log('📊 Live Dashboard:', results[0])
})
```

### **Rip Client** (Programmatic)

```rip
import { RipDataClient } from '@rip/data'

# Connect to the server
db = new RipDataClient 'http://localhost:8306'

# Query data
users = db.query! 'SELECT * FROM users WHERE admin = true'
console.log 'Admin users:', users

# Execute transactions
result = db.execute! '''
  INSERT INTO orders (userId, total, meta)
  VALUES (?, ?, ?)
  RETURNING id
''', [1, 9900, { items: [{ testId: 1 }] }]

console.log 'New order ID:', result[0].id

# Real-time streaming
ws = db.connectWebSocket!
db.subscribe 'live-users', 'SELECT COUNT(*) FROM users', 2000
```

## 🔧 3. Advanced Connection Methods

### **PostgreSQL Wire Protocol** (Coming Soon!)

Once implemented, you can use ANY PostgreSQL tool:

```bash
# psql (PostgreSQL CLI)
psql -h localhost -p 5432 -U admin -d ripdata

# pgAdmin (GUI)
# Host: localhost, Port: 5432, Database: ripdata

# DBeaver (Universal DB tool)
# Connection: PostgreSQL, localhost:5432

# Any ORM that supports PostgreSQL
# Prisma, Drizzle, TypeORM, Sequelize, etc.
```

### **DuckDB Native REPL** (Direct File Access)

```bash
# Install DuckDB CLI
brew install duckdb  # macOS
# or download from https://duckdb.org

# Connect directly to the database file
duckdb apps/labs/api/db/labs.duckdb

# Now you have full DuckDB REPL!
D SELECT * FROM users LIMIT 5;
D .tables
D .schema users
D SELECT COUNT(*) FROM orders;
```

### **HTTP Proxy Tools**

```bash
# HTTPie
http POST localhost:8306/api/query sql="SELECT COUNT(*) FROM users"

# Postman
# POST http://localhost:8306/api/query
# Body: {"sql": "SELECT * FROM orders ORDER BY createdAt DESC LIMIT 10"}

# Insomnia
# Same as Postman - great for API testing
```

## 📊 4. Monitoring & Administration

### **Server Statistics**
```bash
curl http://localhost:8306/stats | jq
```

**Response:**
```json
{
  "activeConnections": 3,
  "writeQueueSize": 0,
  "totalQueries": 1247,
  "avgQueryTime": "12.3ms",
  "uptime": "2h 15m 30s",
  "dbSize": "2.4MB"
}
```

### **Health Checks**
```bash
curl http://localhost:8306/health
```

### **Live Query Monitoring**
```bash
# Monitor all active subscriptions
curl http://localhost:8306/subscriptions
```

## 🎯 5. Development Workflows

### **Local Development Stack**
```bash
# Terminal 1: Start data server
cd apps/labs/api
bun run data:start

# Terminal 2: Setup database
bun run db:push
bun run db:seed

# Terminal 3: Start API server  
bun run dev

# Terminal 4: Interactive queries
duckdb db/labs.duckdb
```

### **Production Deployment**
```bash
# PM2 (Process Manager)
pm2 start rip-data-server.rip --name "rip-data"

# Docker
docker run -d \
  -p 8306:8306 \
  -p 8307:8307 \
  -v ./db:/app/db \
  rip-data-server

# Systemd service
sudo systemctl start rip-data-server
```

## 🔥 6. Features

### **Same Database, Multiple Interfaces**
```bash
# Write via HTTP API
curl -X POST localhost:8306/api/execute \
  -d '{"sql": "INSERT INTO users (email) VALUES (?)", "params": ["api@example.com"]}'

# Read via DuckDB CLI
duckdb db/labs.duckdb -c "SELECT * FROM users WHERE email = 'api@example.com'"

# Stream via WebSocket
# (See JavaScript examples above)

# All accessing the SAME data in real-time!
```

### **S3 Data Lake Integration**
```sql
-- Query S3 data directly through any interface!
SELECT * FROM 's3://my-bucket/data/users/*.parquet'
WHERE created_date > '2024-01-01'
```

### **Real-Time Analytics**
```sql
-- Complex analytics that run instantly
SELECT 
  DATE_TRUNC('hour', createdAt) as hour,
  COUNT(*) as orders,
  SUM(total) as revenue,
  AVG(total) as avg_order_value,
  COUNT(DISTINCT userId) as unique_customers
FROM orders 
WHERE createdAt > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC
```

## 🎯 Summary: Connection Matrix

| Method | Port | Use Case | Tools |
|--------|------|----------|-------|
| **HTTP API** | 8306 | Programmatic access | curl, HTTPie, Postman, @rip/data client |
| **WebSocket** | 8307 | Real-time streaming | Browser, Node.js, @rip/data client |
| **PostgreSQL Wire** | 5432 | Standard DB tools | psql, pgAdmin, DBeaver, ORMs |
| **Direct File** | - | Admin/debugging | DuckDB CLI, DB browsers |

## 🚀 The Rip Advantage

**Traditional Setup:**
- MySQL: Port 3306 (OLTP only)
- Redis: Port 6379 (caching)
- PostgreSQL: Port 5432 (analytics)
- Elasticsearch: Port 9200 (search)
- **= 4 different systems, 4 different ports, 4 different protocols**

**Rip Setup:**
- **RipData Server: Port 8306 (EVERYTHING!)**
- **= 1 system, multiple protocols, unified data**

**One database. Multiple interfaces. Unified data.**