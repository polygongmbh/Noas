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
TEST_PASS="testpass123"

sha256_hex() {
  local value="$1" cmd
  for cmd in "shasum -a 256" "sha256sum" "openssl dgst -sha256 -r"; do
    if command -v "${cmd%% *}" >/dev/null 2>&1; then
      printf '%s' "$value" | $cmd | awk '{print $1}'
      return
    fi
  done
  echo "No SHA-256 tool found (expected shasum, sha256sum, or openssl)" >&2
  exit 1
}

print_response() {
  if [ "$VERBOSE" = true ]; then
    echo "  RESPONSE: $1"
  fi
}

TEST_PASS_HASH=$(sha256_hex "$TEST_PASS")

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

echo "✓ Test 2: Register User"
REGISTER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password_hash\":\"$TEST_PASS_HASH\"}")

print_response "$REGISTER_RESPONSE"
echo "$REGISTER_RESPONSE" | grep -q "success" && echo "  PASS: User registered" || { echo "  FAIL: Registration failed"; echo "$REGISTER_RESPONSE"; exit 1; }
if printf '%s' "$REGISTER_RESPONSE" | grep -qi "unverified_email"; then
  echo "  FAIL: Registration returned unverified_email"
  echo "  Disable email verification for this test run to allow direct sign-in."
  echo "$REGISTER_RESPONSE"
  exit 1
fi
echo ""

echo "✓ Test 3: Sign In"
SIGNIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password_hash\":\"$TEST_PASS_HASH\"}")

print_response "$SIGNIN_RESPONSE"
echo "$SIGNIN_RESPONSE" | grep -q "private_key_encrypted" && echo "  PASS: Sign in successful" || { echo "  FAIL: Sign in failed"; echo "$SIGNIN_RESPONSE"; exit 1; }
echo ""

echo "✓ Test 4: Invalid Password"
INVALID_RESPONSE=$(curl -s -X POST "$API_URL/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password_hash\":\"$(sha256_hex "wrongpass")\"}")

print_response "$INVALID_RESPONSE"
echo "$INVALID_RESPONSE" | grep -q "Invalid credentials" && echo "  PASS: Invalid password rejected" || { echo "  FAIL: Should reject invalid password"; echo "$INVALID_RESPONSE"; exit 1; }
echo ""

echo "✓ Test 5: NIP-05 Verification"
NIP05_RESPONSE=$(curl -s "$BASE_URL/.well-known/nostr.json?name=$TEST_USER")

print_response "$NIP05_RESPONSE"
echo "$NIP05_RESPONSE" | grep -q "\"$TEST_USER\"" && echo "  PASS: NIP-05 verification works" || { echo "  FAIL: NIP-05 failed"; echo "$NIP05_RESPONSE"; exit 1; }
echo ""

echo "✓ Test 6: Duplicate Username"
DUPLICATE_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password_hash\":\"$TEST_PASS_HASH\"}")

print_response "$DUPLICATE_RESPONSE"
echo "$DUPLICATE_RESPONSE" | grep -Eq "already active|pending verification" && echo "  PASS: Duplicate username rejected" || { echo "  FAIL: Should reject duplicate"; echo "$DUPLICATE_RESPONSE"; exit 1; }
echo ""

echo "✓ Test 7: Invalid Username Format"
INVALID_USER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"Invalid-User\",\"password_hash\":\"$TEST_PASS_HASH\"}")

print_response "$INVALID_USER_RESPONSE"
echo "$INVALID_USER_RESPONSE" | grep -q "lowercase" && echo "  PASS: Invalid username format rejected" || { echo "  FAIL: Should reject invalid format"; echo "$INVALID_USER_RESPONSE"; exit 1; }
echo ""

echo "================================"
echo "✅ All integration tests passed!"
echo "Tested user: $TEST_USER"
