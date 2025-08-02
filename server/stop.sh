#!/bin/bash

# 🛑 RIP Server Stop Script
# Cleanly shuts down all RIP server processes

echo "🛑 Stopping RIP Server..."

# Kill all RIP processes
pkill -f "bun manager.ts"
pkill -f "bun server.ts"
pkill -f "bun worker.ts"

# Clean up socket files
rm -f /tmp/rip_worker_*.sock

echo "✅ RIP Server stopped and cleaned up"