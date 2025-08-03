#!/bin/bash

# 🚀 Revolutionary RIP Application Server Startup
# The future of web servers starts here!

MODE=${1:-dev}

echo "🚀 Starting Revolutionary RIP Application Server..."
echo "🌍 Mode: $MODE"

# Configuration based on mode
if [ "$MODE" = "prod" ]; then
    export NODE_ENV=production
    NUM_WORKERS=8
    MAX_REQUESTS=1000
    echo "🏭 Production mode: $NUM_WORKERS workers, $MAX_REQUESTS requests/worker"
else
    export NODE_ENV=development
    NUM_WORKERS=3
    MAX_REQUESTS=10
    echo "🔧 Development mode: $NUM_WORKERS workers, $MAX_REQUESTS requests/worker (hot reload enabled)"
fi

# Kill any existing processes
echo "🧹 Cleaning up previous processes..."
pkill -f "bun manager.ts" 2>/dev/null
pkill -f "bun server.ts" 2>/dev/null
pkill -f "bun worker.ts" 2>/dev/null

# Clean up socket files
rm -f /tmp/rip_worker_*.sock 2>/dev/null

# Get application directory (where the .rip files live)
APP_DIR=${2:-$(pwd)}
echo "📁 Application directory: $APP_DIR"

# Start the revolutionary manager (spawns workers + handles hot reload)
echo "🧠 Starting Revolutionary Manager..."
bun manager.ts $NUM_WORKERS $MAX_REQUESTS "$APP_DIR" &
MANAGER_PID=$!

# Wait for workers to initialize
echo "⏳ Waiting for workers to initialize..."
sleep 3

# Start the HTTP load balancer
echo "🌐 Starting HTTP Load Balancer..."
bun server.ts 3000 $NUM_WORKERS &
SERVER_PID=$!

# Wait for server to start
sleep 2

echo ""
echo "🎉 REVOLUTIONARY RIP APPLICATION SERVER IS RUNNING!"
echo ""
echo "🌐 HTTP Server: http://localhost:3000"
echo "🏥 Health Check: http://localhost:3000/health"
echo "📈 Metrics: http://localhost:3000/metrics"
echo "📊 Manager PID: $MANAGER_PID"
echo "🖥️  Server PID: $SERVER_PID"
echo "🔥 Workers: $NUM_WORKERS (auto-spawned by manager)"
echo ""
echo "🧪 Test Commands:"
echo "  curl http://localhost:3000"
echo "  bun run health"
echo "  bun run load-test"
echo ""

if [ "$MODE" = "dev" ]; then
    echo "🔥 HOT RELOAD ACTIVE:"
    echo "  Edit any .rip file in $APP_DIR"
    echo "  Workers will gracefully restart automatically!"
    echo ""
fi

echo "🛑 Stop with: bun run stop"
echo ""
echo "🌟 Welcome to the FUTURE of web servers! 🚀⚡🔥"