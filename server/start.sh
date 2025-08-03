#!/bin/bash

# 🚀 Rip Application Server Startup
# Modern application server architecture with HTTPS support
#
# Usage:
#   ./start.sh [mode] [foreground] [app_dir] [https_port] [cert_path] [key_path]
#
# Examples:
#   ./start.sh dev                                    # HTTP only
#   ./start.sh prod true                              # Production, foreground
#   ./start.sh dev false /app/path 3443 cert.pem key.pem  # With HTTPS

MODE=${1:-dev}
FOREGROUND=${2:-true}

# Silent startup

# Configuration based on mode
if [ "$MODE" = "prod" ]; then
    export NODE_ENV=production
    NUM_WORKERS=8
    MAX_REQUESTS=1000

else
    export NODE_ENV=development
    NUM_WORKERS=3
    MAX_REQUESTS=10
fi

# Silent cleanup
pkill -f "bun manager.ts" 2>/dev/null
pkill -f "bun server.ts" 2>/dev/null
pkill -f "bun worker.ts" 2>/dev/null

# Clean up socket files
rm -f /tmp/rip_worker_*.sock 2>/dev/null

# Get application directory (where the .rip files live)
APP_DIR=${3:-$(pwd)}

# HTTPS Configuration (optional)
HTTPS_PORT=${4:-3443}
CERT_PATH=${5}    # Optional: SSL certificate path
KEY_PATH=${6}     # Optional: SSL private key path

# Check HTTPS configuration
if [ -n "$CERT_PATH" ] && [ -n "$KEY_PATH" ]; then
    if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
        HTTPS_ENABLED=true
    else
        # Auto-generate SSL certificates silently
        SSL_DIR=$(dirname "$CERT_PATH")
        mkdir -p "$SSL_DIR"

        # Generate private key and certificate
        openssl genrsa -out "$KEY_PATH" 2048 2>/dev/null
        openssl req -new -x509 -key "$KEY_PATH" -out "$CERT_PATH" -days 365 \
            -subj "/C=US/ST=Development/L=Localhost/O=Rip Server/CN=localhost" 2>/dev/null

        # Set permissions
        chmod 644 "$CERT_PATH"
        chmod 600 "$KEY_PATH"

        HTTPS_ENABLED=true
    fi
else
    HTTPS_ENABLED=false
fi

if [ "$FOREGROUND" = "false" ]; then
    echo "🔇 Background mode: Quiet startup, 'bun run stop' to stop"
fi

# Start the manager (spawns workers + handles hot reload)
if [ "$FOREGROUND" = "true" ]; then
    # Show essential info first
    echo ""
    echo "🌐 Endpoints:"
    if [ "$HTTPS_ENABLED" = "true" ]; then
        echo "   🔒 HTTPS:   https://localhost:$HTTPS_PORT"
        echo "   🏥 Health:  https://localhost:$HTTPS_PORT/health"
        echo "   📈 Metrics: https://localhost:$HTTPS_PORT/metrics"
    else
        echo "   📡 HTTP:    http://localhost:3000"
        echo "   🏥 Health:  http://localhost:3000/health"
        echo "   📈 Metrics: http://localhost:3000/metrics"
    fi
    echo ""

    if [ "$MODE" = "dev" ]; then
        echo "🔥 Hot Reload: $APP_DIR"
    fi

    echo ""
    echo "🛑 Press Ctrl-C to stop"
    echo ""

    # Start manager silently
    bun manager.ts $NUM_WORKERS $MAX_REQUESTS "$APP_DIR" &
    MANAGER_PID=$!

    sleep 3

    # Start server silently
    if [ "$HTTPS_ENABLED" = "true" ]; then
        bun server.ts 3000 $NUM_WORKERS $HTTPS_PORT "$CERT_PATH" "$KEY_PATH" &
    else
        bun server.ts 3000 $NUM_WORKERS &
    fi
    SERVER_PID=$!

    sleep 2

    # Setup graceful shutdown handler for foreground mode
    cleanup() {
        echo ""

        # Stop server first (stops accepting new requests)
        if kill -TERM $SERVER_PID 2>/dev/null; then
            wait $SERVER_PID 2>/dev/null
        fi

        # Then stop manager (stops workers)
        if kill -TERM $MANAGER_PID 2>/dev/null; then
            wait $MANAGER_PID 2>/dev/null
        fi

        exit 0
    }

    # Trap Ctrl-C and handle cleanup
    trap cleanup SIGINT SIGTERM
else
    # Background mode - quiet startup
    echo "🧠 Starting manager and workers..."
    bun manager.ts $NUM_WORKERS $MAX_REQUESTS "$APP_DIR" >/dev/null 2>&1 &
    MANAGER_PID=$!

    sleep 3

    if [ "$HTTPS_ENABLED" = "true" ]; then
        bun server.ts 3000 $NUM_WORKERS $HTTPS_PORT "$CERT_PATH" "$KEY_PATH" >/dev/null 2>&1 &
    else
        bun server.ts 3000 $NUM_WORKERS >/dev/null 2>&1 &
    fi
    SERVER_PID=$!

    sleep 2
fi

if [ "$FOREGROUND" = "true" ]; then
    # Wait indefinitely until interrupted
    while true; do
        sleep 1
    done
else
    # Background mode - just success message
    # Quick health check to make sure it started
    sleep 1
    if curl -s http://localhost:3000/health >/dev/null 2>&1; then
        echo "✅ Server launched successfully:"
        echo "   📡 HTTP:  http://localhost:3000"
        if [ "$HTTPS_ENABLED" = "true" ]; then
            echo "   🔒 HTTPS: https://localhost:$HTTPS_PORT"
        fi
        if [ "$MODE" = "dev" ]; then
            echo "🔥 Hot reload active - edit .rip files to trigger restarts"
        fi
        echo "🛑 Stop with: bun run stop"
    else
        echo "❌ Server failed to start"
        exit 1
    fi
fi