#!/bin/bash

# 🔒 Generate Self-Signed SSL Certificate for Testing
# Creates certificate and private key for HTTPS development

echo "🔐 Generating self-signed SSL certificate for HTTPS testing..."

# Create ssl directory if it doesn't exist
mkdir -p ../ssl

# Generate private key
openssl genrsa -out ../ssl/server.key 2048

# Generate certificate
openssl req -new -x509 -key ../ssl/server.key -out ../ssl/server.crt -days 365 -subj "/C=US/ST=Development/L=Localhost/O=Rip Server/CN=localhost"

echo "✅ SSL certificate generated:"
echo "   🔑 Private Key: ssl/server.key"
echo "   📜 Certificate: ssl/server.crt"
echo ""
echo "🚀 To start server with HTTPS:"
echo "   ./start.sh dev false /path/to/app 3443 ssl/server.crt ssl/server.key"
echo ""
echo "🧪 Test HTTPS (ignore certificate warnings for self-signed):"
echo "   curl -k https://localhost:3443"
echo ""
echo "⚠️  Note: Self-signed certificates will show browser warnings"
echo "   For production, use certificates from a trusted CA"

# Make certificate readable
chmod 644 ../ssl/server.crt
chmod 600 ../ssl/server.key

echo ""
echo "🔒 Certificate ready for development use!"