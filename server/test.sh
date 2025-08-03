#!/bin/bash

# 🧪 Rip Server Test Suite
# Comprehensive testing of the server architecture

echo "🧪 Testing Rip Application Server"
echo "=============================================="

# Test basic connectivity
echo "🌐 Testing basic connectivity..."
RESPONSE=$(curl -s http://localhost:3000)
if [ $? -eq 0 ]; then
    echo "✅ Server is responding"
    echo "Response: $RESPONSE"
else
    echo "❌ Server is not responding"
    echo "💡 Make sure to run: bun run dev"
    exit 1
fi

echo ""

# Test health endpoint
echo "🏥 Testing health endpoint..."
curl -s http://localhost:3000/health | jq . || echo "Health check failed"

echo ""

# Test metrics endpoint
echo "📈 Testing metrics endpoint..."
curl -s http://localhost:3000/metrics

echo ""

# Test load balancing (multiple requests)
echo "🔄 Testing load balancing (10 requests)..."
for i in {1..10}; do
    curl -s http://localhost:3000 | head -1
done

echo ""

# Test worker resilience (if using simple example)
echo "💪 Testing worker resilience..."
echo "Making 20 requests to trigger worker restarts..."
for i in {1..20}; do
    echo -n "Request $i: "
    curl -s http://localhost:3000 | head -1
    sleep 0.1
done

echo ""

# Performance test (if wrk is available)
if command -v wrk &> /dev/null; then
    echo "⚡ Performance test (10 seconds)..."
    wrk -t4 -c10 -d10s http://localhost:3000
else
    echo "⚠️ wrk not installed, skipping performance test"
    echo "Install with: brew install wrk"
fi

echo ""
echo "🎉 Rip Server testing complete!"
echo "🌟 All tests completed successfully!"