#!/bin/bash
# Rebuild the BUMPS parser from grammar.coffee

cd "$(dirname "$0")"
echo "Rebuilding BUMPS parser..."
coffee ../../solar.coffee grammar.coffee -o parser.js

if [ $? -eq 0 ]; then
    echo "✓ Parser rebuilt successfully"
else
    echo "✗ Parser build failed"
    exit 1
fi
