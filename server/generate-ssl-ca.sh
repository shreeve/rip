#!/bin/bash

# =============================================================================
# ssl-certs.sh - Self-signing SSL certificates with local CA
#
#  Author: Steve Shreeve <steve.shreeve@gmail.com>
# Updated: Aug 3, 2025
# =============================================================================

set -euo pipefail

# Usage
if [[ "${1:-}" == "--help" ]]; then
  echo "Usage: $0 [--clean]"
  echo "  --clean   Remove the CSR file after generating the certificate"
  exit 0
fi

CLEANUP=false

[[ "${1:-}" == "--clean" ]] && CLEANUP=true

# -----------------------------------------------------------------------------
# Configurable variables
# -----------------------------------------------------------------------------

: "${ORG_NAME:=ACME, Inc.}"
: "${DOMAIN_BASE:=acme.com}"
: "${CA_NAME:=Custom Root CA}"
: "${ORG_UNIT:=$(whoami)@$(hostname) ($(/usr/bin/id -F))}"

ROOT_NAME="root"

# -----------------------------------------------------------------------------
# Cross-platform IP detection (macOS / Linux)
# -----------------------------------------------------------------------------

if [[ "$OSTYPE" == "darwin"* ]]; then
  MY_IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1 || echo "127.0.0.1")
else
  MY_IP=$(hostname -I | awk '{print $1}' || echo "127.0.0.1")
fi

# -----------------------------------------------------------------------------
# Generate Root CA key and certificate
# -----------------------------------------------------------------------------

openssl genrsa -out "${ROOT_NAME}.key" 3072
openssl req -x509 -nodes -sha256 -new -key "${ROOT_NAME}.key" -out "${ROOT_NAME}.crt" -days 731 \
  -subj "/CN=${CA_NAME}" \
  -addext "keyUsage = critical, keyCertSign" \
  -addext "basicConstraints = critical, CA:TRUE, pathlen:0" \
  -addext "subjectKeyIdentifier = hash"

# -----------------------------------------------------------------------------
# Generate site key and certificate signing request
# -----------------------------------------------------------------------------

openssl genrsa -out "${DOMAIN_BASE}.key" 2048
openssl req -sha256 -new -key "${DOMAIN_BASE}.key" -out "${DOMAIN_BASE}.csr" \
  -subj "/CN=*.${DOMAIN_BASE}/O=${ORG_NAME}/OU=${ORG_UNIT}" \
  -reqexts SAN -config <(cat <<-EOF
    [SAN]
    subjectAltName=DNS:${DOMAIN_BASE},DNS:*.${DOMAIN_BASE},IP:127.0.0.1,IP:${MY_IP}
EOF
)

# -----------------------------------------------------------------------------
# Sign the certificate
# -----------------------------------------------------------------------------

openssl x509 -req -sha256 -in "${DOMAIN_BASE}.csr" -out "${DOMAIN_BASE}.crt" -days 731 \
  -CAkey "${ROOT_NAME}.key" -CA "${ROOT_NAME}.crt" -CAcreateserial -extfile <(cat <<-EOF
    subjectAltName = DNS:${DOMAIN_BASE},DNS:*.${DOMAIN_BASE},IP:127.0.0.1,IP:${MY_IP}
    keyUsage = critical, digitalSignature, keyEncipherment
    extendedKeyUsage = serverAuth
    basicConstraints = CA:FALSE
    authorityKeyIdentifier = keyid:always
    subjectKeyIdentifier = hash
EOF
)

# -----------------------------------------------------------------------------
# macOS trust store integration
# -----------------------------------------------------------------------------

if [[ "$OSTYPE" == "darwin"* ]]; then
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${ROOT_NAME}.crt"
fi

# -----------------------------------------------------------------------------
# Optional cleanup
# -----------------------------------------------------------------------------

$CLEANUP && rm -f "${DOMAIN_BASE}.csr"

# -----------------------------------------------------------------------------
# Review
# -----------------------------------------------------------------------------

echo "-- ROOT CERTIFICATE --"
openssl x509 -in "${ROOT_NAME}.crt" -noout -text

echo "-- CERT REQUEST --"
openssl req  -in "${DOMAIN_BASE}.csr" -noout -text 2>/dev/null || echo "(CSR removed)"

echo "-- SIGNED CERTIFICATE --"
openssl x509 -in "${DOMAIN_BASE}.crt" -noout -text
