#!/usr/bin/env bash
# ensure-mac-cert.sh — Ensure persistent local code-signing identity for macOS TCC stability
# Retains permanent Accessibility and Screen & System Audio Recording permissions across rebuilds.

set -eo pipefail

CERT_NAME="AudioUtilityLocalCert"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
if [ ! -f "$KEYCHAIN" ]; then
  KEYCHAIN="${HOME}/Library/Keychains/login.keychain"
fi

echo "==> Verifying persistent macOS code-signing identity: ${CERT_NAME}..."

# 1. Check if the certificate identity already exists in keychain
if security find-certificate -c "${CERT_NAME}" "${KEYCHAIN}" >/dev/null 2>&1 || \
   security find-identity -p codesigning 2>/dev/null | grep -q "${CERT_NAME}"; then
  echo "✓ Code-signing certificate '${CERT_NAME}' already exists in keychain. Skipping creation."
  exit 0
fi

echo "==> Generating persistent 10-year self-signed Code Signing Certificate: ${CERT_NAME}..."
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

CONFIG_FILE="${TMP_DIR}/codesign.cnf"
cat << EOF > "$CONFIG_FILE"
[ req ]
default_bits        = 2048
default_md          = sha256
prompt              = no
distinguished_name  = req_distinguished_name
x509_extensions     = v3_codesign

[ req_distinguished_name ]
CN = ${CERT_NAME}

[ v3_codesign ]
basicConstraints    = critical,CA:FALSE
keyUsage            = critical,digitalSignature
extendedKeyUsage    = critical,codeSigning
EOF

# Prefer Apple's built-in LibreSSL (/usr/bin/openssl) to ensure PKCS#12 compatibility with macOS Security.framework
OPENSSL_BIN="/usr/bin/openssl"
if [ ! -x "$OPENSSL_BIN" ]; then
  OPENSSL_BIN="openssl"
fi

KEY_FILE="${TMP_DIR}/cert.key"
CERT_FILE="${TMP_DIR}/cert.crt"
P12_FILE="${TMP_DIR}/cert.p12"
PASS="audioutility"

"$OPENSSL_BIN" req -x509 -newkey rsa:2048 -nodes \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -days 3650 \
  -config "$CONFIG_FILE" >/dev/null 2>&1

"$OPENSSL_BIN" pkcs12 -export \
  -inkey "$KEY_FILE" \
  -in "$CERT_FILE" \
  -out "$P12_FILE" \
  -passout "pass:${PASS}" \
  -name "${CERT_NAME}" >/dev/null 2>&1

echo "==> Importing certificate into login keychain..."
# Import with -A and -T /usr/bin/codesign so codesign can access the private key without blocking prompts
security import "$P12_FILE" \
  -k "$KEYCHAIN" \
  -P "$PASS" \
  -A \
  -T /usr/bin/codesign >/dev/null 2>&1

echo "==> Registering codeSign trust settings..."
# Configure trust settings silently (suppress UI prompts if non-interactive)
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$CERT_FILE" 2>/dev/null || true

echo "✓ Local Code Signing certificate '${CERT_NAME}' created and registered successfully."
exit 0
