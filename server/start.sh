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

echo "🚀 Starting Rip Application Server..."
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
APP_DIR=${3:-$(pwd)}

# HTTPS Configuration (optional)
HTTPS_PORT=${4:-3443}
CERT_PATH=${5}    # Optional: SSL certificate path
KEY_PATH=${6}     # Optional: SSL private key path

# Check HTTPS configuration
if [ -n "$CERT_PATH" ] && [ -n "$KEY_PATH" ]; then
    if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
        HTTPS_ENABLED=true
        echo "🔒 HTTPS enabled: cert=$CERT_PATH, key=$KEY_PATH, port=$HTTPS_PORT"
    else
        echo "🔐 HTTPS certificates not found - auto-generating..."
        echo "   Cert path: $CERT_PATH"
        echo "   Key path: $KEY_PATH"

        # Auto-generate SSL certificates
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
        echo "✅ Auto-generated SSL certificates for development"
        echo "🔒 HTTPS enabled: cert=$CERT_PATH, key=$KEY_PATH, port=$HTTPS_PORT"
    fi
else
    HTTPS_ENABLED=false
    echo "📡 HTTP only mode (no HTTPS certificates requested)"
fi

if [ "$FOREGROUND" = "true" ]; then
    echo "📺 Foreground mode: All logs visible, Ctrl-C to stop"
    echo "📁 Application directory: $APP_DIR"
else
    echo "🔇 Background mode: Quiet startup, 'bun run stop' to stop"
fi

# Start the manager (spawns workers + handles hot reload)
if [ "$FOREGROUND" = "true" ]; then
    echo "🧠 Starting Manager..."
    bun manager.ts $NUM_WORKERS $MAX_REQUESTS "$APP_DIR" &
    MANAGER_PID=$!

    echo "⏳ Waiting for workers to initialize..."
    sleep 3

    echo "🌐 Starting HTTP Server..."
    if [ "$HTTPS_ENABLED" = "true" ]; then
        echo "    🔒 With HTTPS support on port $HTTPS_PORT"
        bun server.ts 3000 $NUM_WORKERS $HTTPS_PORT "$CERT_PATH" "$KEY_PATH" &
    else
        bun server.ts 3000 $NUM_WORKERS &
    fi
    SERVER_PID=$!

    sleep 2
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
    echo ""
    echo "🎉 RIP APPLICATION SERVER IS RUNNING!"
    echo ""
    echo "🌐 HTTP Server: http://localhost:3000"
    if [ "$HTTPS_ENABLED" = "true" ]; then
        echo "🔒 HTTPS Server: https://localhost:$HTTPS_PORT"
    fi
    echo "🏥 Health Check: http://localhost:3000/health"
    echo "📈 Metrics: http://localhost:3000/metrics"
    if [ "$HTTPS_ENABLED" = "true" ]; then
        echo "🔒 Secure Health: https://localhost:$HTTPS_PORT/health"
        echo "🔒 Secure Metrics: https://localhost:$HTTPS_PORT/metrics"
    fi
    echo "📊 Manager PID: $MANAGER_PID"
    echo "🖥️  Server PID: $SERVER_PID"
    echo "🔥 Workers: $NUM_WORKERS (auto-spawned by manager)"
    echo ""
    echo "🧪 Test Commands:"
    echo "  curl http://localhost:3000"
    if [ "$HTTPS_ENABLED" = "true" ]; then
        echo "  curl -k https://localhost:$HTTPS_PORT"
    fi
    echo "  bun run health"
    echo "  bun run load-test"
    echo ""

    if [ "$MODE" = "dev" ]; then
        echo "🔥 HOT RELOAD ACTIVE:"
        echo "  Edit any .rip file in $APP_DIR"
        echo "  Workers will gracefully restart automatically!"
        echo ""
    fi

    echo "💡 Press Ctrl-C to stop"
    echo ""
    echo "🌟 Server started successfully! 🚀"

    # Wait in foreground - logs will show, Ctrl-C will kill
    wait
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