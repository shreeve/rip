#!/bin/bash

# 🚀 RIP Server Startup Script
# Starts the complete RIP server architecture

echo "🚀 Starting RIP Server..."

# Kill any existing processes
pkill -f "bun manager.ts" 2>/dev/null
pkill -f "bun server.ts" 2>/dev/null
pkill -f "bun worker.ts" 2>/dev/null

# Clean up any leftover socket files
rm -f /tmp/rip_worker_*.sock 2>/dev/null

echo "🧹 Cleaned up previous processes..."

# Start the manager (spawns workers automatically)
echo "📊 Starting process manager..."
bun manager.ts &
MANAGER_PID=$!

# Wait for workers to initialize
sleep 2

# Start the HTTP server
echo "🌐 Starting HTTP server..."
bun server.ts &
SERVER_PID=$!

# Wait for server to start
sleep 1

echo ""
echo "✅ RIP Server is running!"
echo "🌐 HTTP Server: http://localhost:3000"
echo "📊 Manager PID: $MANAGER_PID"
echo "🖥️  Server PID: $SERVER_PID"
echo ""
echo "🧪 Test with: curl http://localhost:3000"
echo "⚡ Load test: wrk -t4 -c10 -d10s http://localhost:3000"
echo "🛑 Stop with: ./stop.sh"
echo ""