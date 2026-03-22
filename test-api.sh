#!/bin/bash
# Integration Test Script for Noas API
# Tests all endpoints with actual HTTP requests

set -e

BASE_URL="http://localhost:3000"
VERBOSE=false

for arg in "$@"; do
  case "$arg" in
    -v|--verbose)
      VERBOSE=true
      ;;
  esac
done

TEST_USER="test_$(date +%s)"
TEST_USER_WITH_KEY="${TEST_USER}_key"
TEST_PASS="testpass123"

sha256_hex() {
  if command -v shasum >/dev/null 2>&1; then printf '%s' "$1" | shasum -a 256 | awk '{print $1}'; return; fi
  if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum | awk '{print $1}'; return; fi
  printf '%s' "$1" | openssl dgst -sha256 -r | awk '{print $1}'
}

post_json() {
  local path="$1"
  local payload="$2"
  curl -s -X POST "$API_URL$path" -H "Content-Type: application/json" -d "$payload"
}

assert_active_registration() {
  local response="$1"
  local label="$2"

  print_response "$response"
  echo "$response" | grep -q "success" && echo "  PASS: $label" || { echo "  FAIL: $label"; echo "$response"; exit 1; }
  if printf '%s' "$response" | grep -qi "unverified_email"; then
    echo "  FAIL: Registration returned unverified_email"
    echo "  Disable email verification for this test run to allow direct sign-in."
    echo "$response"
    exit 1
  fi
}

verify_returned_keypair() {
  local expected_public_key="$1"
  local private_key_encrypted="$2"
  local password="$3"

  EXPECTED_PUBLIC_KEY="$expected_public_key" \
  PRIVATE_KEY_ENCRYPTED="$private_key_encrypted" \
  VERIFY_PASSWORD="$password" \
  node --input-type=module <<'EOF'
import { getPublicKey } from 'nostr-tools';
import { decrypt } from 'nostr-tools/nip49';

const expectedPublicKey = String(process.env.EXPECTED_PUBLIC_KEY || '').trim().toLowerCase();
const privateKeyEncrypted = String(process.env.PRIVATE_KEY_ENCRYPTED || '').trim();
const password = String(process.env.VERIFY_PASSWORD || '');

if (!expectedPublicKey || !privateKeyEncrypted || !password) {
  console.error('Missing key verification input');
  process.exit(1);
}

const secretKey = decrypt(privateKeyEncrypted, password);
const actualPublicKey = getPublicKey(secretKey).toLowerCase();

if (actualPublicKey !== expectedPublicKey) {
  console.error(`Pubkey mismatch: expected ${expectedPublicKey}, got ${actualPublicKey}`);
  process.exit(1);
}
EOF
}

print_response() {
  if [ "$VERBOSE" = true ]; then
    echo "  RESPONSE: $1"
  fi
}

echo "🧪 Noas API Integration Tests"
echo "================================"
echo ""

echo "✓ Test 1: Health Check"
HEALTH_RESPONSE=$(curl -s "$BASE_URL/health")
print_response "$HEALTH_RESPONSE"
echo "$HEALTH_RESPONSE" | grep -q "ok" && echo "  PASS: Server is healthy" || { echo "  FAIL: Health check failed"; echo "$HEALTH_RESPONSE"; exit 1; }
echo ""

echo "✓ Obtaining api base"
API_URL=$(curl -s "$BASE_URL/.well-known/nostr.json" | jq -r '.noas.api_base // empty' || true)
API_URL=${API_URL:-"$BASE_URL/api/v1"}
TEST_PASS_HASH=$(sha256_hex "$TEST_PASS")
WRONG_PASS_HASH=$(sha256_hex "wrongpass")

echo "✓ Test 2: Register User Without Key"
REGISTER_RESPONSE=$(post_json "/auth/register" "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}")
assert_active_registration "$REGISTER_RESPONSE" "User registered"
echo ""

echo "✓ Test 3: Sign In With Password Hash"
SIGNIN_RESPONSE=$(post_json "/auth/signin" "{\"username\":\"$TEST_USER\",\"password_hash\":\"$TEST_PASS_HASH\"}")
print_response "$SIGNIN_RESPONSE"
RETURNED_PUBLIC_KEY=$(jq -r '.public_key // empty' <<<"$SIGNIN_RESPONSE")
RETURNED_PRIVATE_KEY_ENCRYPTED=$(jq -r '.private_key_encrypted // empty' <<<"$SIGNIN_RESPONSE")
[ -n "$RETURNED_PUBLIC_KEY" ] && [ -n "$RETURNED_PRIVATE_KEY_ENCRYPTED" ] && echo "  PASS: Sign in returned key material" || { echo "  FAIL: Sign in failed"; echo "$SIGNIN_RESPONSE"; exit 1; }
echo ""

echo "✓ Test 4: Validate Returned Key"
verify_returned_keypair "$RETURNED_PUBLIC_KEY" "$RETURNED_PRIVATE_KEY_ENCRYPTED" "$TEST_PASS" && echo "  PASS: Returned encrypted key matches returned public key" || { echo "  FAIL: Returned encrypted key is invalid"; exit 1; }
echo ""

echo "✓ Test 5: Register User With Returned Key"
REGISTER_WITH_KEY_RESPONSE=$(post_json "/auth/register" "{\"username\":\"$TEST_USER_WITH_KEY\",\"password_hash\":\"$TEST_PASS_HASH\",\"public_key\":\"$RETURNED_PUBLIC_KEY\",\"private_key_encrypted\":\"$RETURNED_PRIVATE_KEY_ENCRYPTED\"}")
assert_active_registration "$REGISTER_WITH_KEY_RESPONSE" "User registered with provided key"
echo ""

echo "✓ Test 6: Sign In With Password Hash For Provided Key"
SIGNIN_WITH_KEY_RESPONSE=$(post_json "/auth/signin" "{\"username\":\"$TEST_USER_WITH_KEY\",\"password_hash\":\"$TEST_PASS_HASH\"}")

print_response "$SIGNIN_WITH_KEY_RESPONSE"
SIGNIN_WITH_KEY_PUBLIC_KEY=$(jq -r '.public_key // empty' <<<"$SIGNIN_WITH_KEY_RESPONSE")
SIGNIN_WITH_KEY_PRIVATE_KEY_ENCRYPTED=$(jq -r '.private_key_encrypted // empty' <<<"$SIGNIN_WITH_KEY_RESPONSE")
[ "$SIGNIN_WITH_KEY_PUBLIC_KEY" = "$RETURNED_PUBLIC_KEY" ] && [ "$SIGNIN_WITH_KEY_PRIVATE_KEY_ENCRYPTED" = "$RETURNED_PRIVATE_KEY_ENCRYPTED" ] && echo "  PASS: Sign in returned the provided key material" || { echo "  FAIL: Sign in did not return the provided key material"; echo "$SIGNIN_WITH_KEY_RESPONSE"; exit 1; }
verify_returned_keypair "$SIGNIN_WITH_KEY_PUBLIC_KEY" "$SIGNIN_WITH_KEY_PRIVATE_KEY_ENCRYPTED" "$TEST_PASS" && echo "  PASS: Provided key remains valid after sign in" || { echo "  FAIL: Provided key is invalid after sign in"; exit 1; }
echo ""

echo "✓ Test 7: Invalid Password Hash"
INVALID_RESPONSE=$(post_json "/auth/signin" "{\"username\":\"$TEST_USER\",\"password_hash\":\"$WRONG_PASS_HASH\"}")

print_response "$INVALID_RESPONSE"
echo "$INVALID_RESPONSE" | grep -q "Invalid credentials" && echo "  PASS: Invalid password rejected" || { echo "  FAIL: Should reject invalid password"; echo "$INVALID_RESPONSE"; exit 1; }
echo ""

echo "✓ Test 8: NIP-05 Verification"
NIP05_RESPONSE=$(curl -s "$BASE_URL/.well-known/nostr.json?name=$TEST_USER")

print_response "$NIP05_RESPONSE"
echo "$NIP05_RESPONSE" | grep -q "\"$TEST_USER\"" && echo "  PASS: NIP-05 verification works" || { echo "  FAIL: NIP-05 failed"; echo "$NIP05_RESPONSE"; exit 1; }
echo ""

echo "✓ Test 9: Duplicate Username"
DUPLICATE_RESPONSE=$(post_json "/auth/register" "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}")

print_response "$DUPLICATE_RESPONSE"
echo "$DUPLICATE_RESPONSE" | grep -Eq "already active|pending verification" && echo "  PASS: Duplicate username rejected" || { echo "  FAIL: Should reject duplicate"; echo "$DUPLICATE_RESPONSE"; exit 1; }
echo ""

echo "✓ Test 10: Invalid Username Format"
INVALID_USER_RESPONSE=$(post_json "/auth/register" "{\"username\":\"Invalid-User\",\"password\":\"$TEST_PASS\"}")

print_response "$INVALID_USER_RESPONSE"
echo "$INVALID_USER_RESPONSE" | grep -q "lowercase" && echo "  PASS: Invalid username format rejected" || { echo "  FAIL: Should reject invalid format"; echo "$INVALID_USER_RESPONSE"; exit 1; }
echo ""

echo "================================"
echo "✅ All integration tests passed!"
echo "Tested user: $TEST_USER"
