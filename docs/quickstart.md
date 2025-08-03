<img src="assets/logos/rip-icon-512wa.png" style="width:50px" /> <br>

# Quickstart Guide

Welcome to **Rip** - the multilanguage universal runtime! This guide will get you up and running with both the Rip language and the powerful Rip Application Server in just minutes.

---

## 🚀 Installation

### Prerequisites
- **Bun** (v1.0.0+) - [Install Bun](https://bun.sh)
- **Node.js** (v18+) - For compatibility (optional)

### Install Rip
```bash
# Clone the Rip ecosystem
git clone https://github.com/rip-ecosystem/rip.git
cd rip

# Install dependencies
bun install
```

---

## 🌟 Your First Rip Program

### 1. **Create a Simple Script**
```coffeescript
# hello.rip
name = "World"
greeting = "Hello, #{name}!"
console.log greeting

# Elegant array comprehension
numbers = [1..5]
squares = (n * n for n in numbers)
console.log "Squares:", squares
```

### 2. **Run It**
```bash
rip hello.rip
# Output:
# Hello, World!
# Squares: [ 1, 4, 9, 16, 25 ]
```

---

## 🌐 Your First Rip Web Application

### 1. **Create a Web App**
```coffeescript
# app.rip - A simple web application
import { Hono } from 'hono'

app = new Hono

# Root endpoint
app.get '/', (c) ->
  c.json
    message: 'Welcome to Rip! 🚀'
    time: new Date().toISOString()
    language: 'rip'

# API endpoint with path parameters
app.get '/greet/:name', (c) ->
  name = c.req.param 'name'
  c.json
    greeting: "Hello, #{name}!"
    timestamp: Date.now()

# Health check
app.get '/health', (c) -> c.text 'healthy'

# Export for the server
export default app
```

### 2. **Start the Server**
```bash
# Navigate to your app directory
cd my-rip-app

# Start the server (HTTP by default)
rip-server

# Or start with HTTPS
rip-server https
```

### 3. **Test Your App**
```bash
# Test HTTP (default)
curl http://localhost:3000
curl http://localhost:3000/greet/Developer
curl http://localhost:3000/health

# Test HTTPS (if using https mode)
curl -k https://localhost:3443
```

---

## 🔥 Hot Reloading in Action

1. **Start your server** (if not already running):
   ```bash
   bun run dev
   ```

2. **Edit your app.rip** while the server is running:
   ```coffeescript
   # Change the root endpoint message
   app.get '/', (c) ->
     c.json
       message: 'Welcome to the AMAZING Rip! 🌟✨'
       version: '1.0.0'
       features: ['hot-reload', 'https', 'multi-process']
   ```

3. **Watch the magic** - Save the file and see instant reload!

---

## 🏗️ Application Structure

### **Recommended Project Layout**
```
my-rip-app/
├── index.rip          # Main application entry point
├── package.json       # Server configuration
├── routes/
│   ├── api.rip        # API routes
│   └── auth.rip       # Authentication
├── models/
│   └── user.rip       # Data models
└── static/           # Static files (if needed)
    └── index.html
```

### **Example package.json**
```json
{
  "name": "my-rip-app",
  "module": "index.rip",
  "type": "module",
  "scripts": {
    "dev": "cd /Users/shreeve/Data/Code/rip/server && ./start.sh dev true $PWD 3443 ssl/server.crt ssl/server.key",
    "start": "cd /Users/shreeve/Data/Code/rip/server && ./start.sh prod true $PWD 3443 ssl/server.crt ssl/server.key",
    "stop": "cd /Users/shreeve/Data/Code/rip/server && ./stop.sh",
    "test": "curl -s -k https://localhost:3443",
    "health": "curl -s -k https://localhost:3443/health | jq ."
  },
  "dependencies": {
    "hono": "^4.8.12"
  }
}
```

---

## 📊 Monitoring Your App

### **Built-in Endpoints**
- **🏥 Health Check**: `https://localhost:3443/health`
- **📈 Metrics**: `https://localhost:3443/metrics`
- **ℹ️ Info**: `https://localhost:3443/info`

### **Server Logs**
The server provides detailed, real-time logging:
```
[2025-08-03 12:34:56.789-06:00              ] Manager starting (3 workers, 10 requests each)
[2025-08-03 12:34:56.801-06:00              ] Server ready! 🚀
[2025-08-03 12:34:57.123-06:00 1.2ms  45µs] W1.1 GET / → 200 json 156B
[2025-08-03 12:34:58.456-06:00              ] File changed: index.rip
[2025-08-03 12:34:58.789-06:00 2.1ms  67µs] W2.1 GET /greet/Alice → 200 json 89B
```

---

## 🔒 HTTPS & Production

### **Development HTTPS** (Auto-Generated)
```bash
# Starts with auto-generated SSL certificates
bun run dev
# ✅ Certificates created automatically
# 🌐 https://localhost:3443 (primary)
# 📡 http://localhost:3000 (fallback)
```

### **Production HTTPS** (Your Certificates)
```bash
# Using Let's Encrypt certificates
bun run start \
  --port 3443 \
  --cert /etc/letsencrypt/live/yourdomain.com/fullchain.pem \
  --key /etc/letsencrypt/live/yourdomain.com/privkey.pem
```

---

## 🎯 Key Rip Language Features

### **1. Elegant Syntax**
```coffeescript
# Object literals with ease
user =
  name: 'Alice'
  age: 30
  active: true
  tags: ['developer', 'rip-enthusiast']

# Function definitions
greet = (name, time = 'day') ->
  "Good #{time}, #{name}!"

# Array comprehensions
evens = (n for n in [1..20] when n % 2 is 0)
```

### **2. Modern JavaScript Output**
```javascript
// Clean, readable JavaScript (no wrapper functions)
const user = {
  name: 'Alice',
  age: 30,
  active: true,
  tags: ['developer', 'rip-enthusiast']
};

const greet = (name, time = 'day') => {
  return `Good ${time}, ${name}!`;
};

const evens = (() => {
  const result = [];
  for (let n = 1; n <= 20; n++) {
    if (n % 2 === 0) {
      result.push(n);
    }
  }
  return result;
})();
```

---

## 🚀 Next Steps

### **Explore Advanced Features**
- **[Architecture Deep Dive](../server/architecture.md)** - Multi-process server internals
- **[Production SSL Guide](../server/production-ssl.md)** - Enterprise deployment
- **[Language Enhancements](./language-enhancements.md)** - Rip vs CoffeeScript

### **Build Real Applications**
- **[Working Examples](../server/examples/)** - Complete application samples
- **[API Patterns](../server/examples/api/)** - RESTful API development
- **[Static Sites](../server/examples/simple/)** - Simple web applications

### **Join the Community**
- **Contribute**: Submit PRs and issues on GitHub
- **Share**: Show off your Rip applications
- **Learn**: Explore the grammar and parsing engine

---

*Welcome to the Rip ecosystem - where elegant code meets powerful performance!* 🌟

**Happy Ripping!** 🚀