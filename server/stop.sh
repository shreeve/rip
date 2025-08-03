#!/bin/bash

# 🛑 Rip Application Server Stop Script
# Graceful shutdown of the entire server architecture
# Location-independent - can be run from anywhere

echo "🛑 Stopping Rip Application Server..."

# Send SIGTERM for graceful shutdown (location-independent patterns)
echo "👋 Sending graceful shutdown signals..."
pkill -TERM -f "bun.*manager\.ts"
pkill -TERM -f "bun.*server\.ts"
pkill -TERM -f "bun.*worker\.ts"

# Wait a moment for graceful shutdown
sleep 2

# Force kill any remaining processes (location-independent patterns)
echo "💥 Force stopping any remaining processes..."
pkill -KILL -f "bun.*manager\.ts" 2>/dev/null
pkill -KILL -f "bun.*server\.ts" 2>/dev/null
pkill -KILL -f "bun.*worker\.ts" 2>/dev/null

# Clean up socket files
echo "🧹 Cleaning up socket files..."
rm -f /tmp/rip_worker_*.sock

echo "✅ Rip Application Server stopped and cleaned up"
echo "🌟 Server stopped successfully"