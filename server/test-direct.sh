#!/bin/bash
# Direct test of manager spawn

echo "Testing direct manager execution..."
echo "Current PATH: $PATH"
echo "Which bun: $(which bun)"
echo ""

# Run manager directly
bun manager.ts 0 3 10 ../api