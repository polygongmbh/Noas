#!/bin/bash
# Integration Test Script for Noas API
# Tests all endpoints with actual HTTP requests

set -e

BASE_URL="http://localhost:3000"
TEST_USER="test_$(date +%s)"
TEST_PASS="testpass123"
PUBLIC_KEY="abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234"
ENC_KEY="ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p"

echo "🧪 Noas API Integration Tests"
echo "================================"
echo ""

# Test 1: Health Check
echo "✓ Test 1: Health Check"
curl -s "$BASE_URL/health" | grep -q "ok" && echo "  PASS: Server is healthy" || { echo "  FAIL: Health check failed"; exit 1; }
echo ""

# Test 2: Register User
echo "✓ Test 2: Register User"
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\",\"publicKey\":\"$PUBLIC_KEY\",\"encryptedPrivateKey\":\"$ENC_KEY\"}")

echo "$REGISTER_RESPONSE" | grep -q "success" && echo "  PASS: User registered" || { echo "  FAIL: Registration failed"; echo "$REGISTER_RESPONSE"; exit 1; }
echo ""

# Test 3: Sign In
echo "✓ Test 3: Sign In"
SIGNIN_RESPONSE=$(curl -s -X POST "$BASE_URL/signin" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}")

echo "$SIGNIN_RESPONSE" | grep -q "encryptedPrivateKey" && echo "  PASS: Sign in successful" || { echo "  FAIL: Sign in failed"; echo "$SIGNIN_RESPONSE"; exit 1; }
echo ""

# Test 4: Invalid Password
echo "✓ Test 4: Invalid Password"
INVALID_RESPONSE=$(curl -s -X POST "$BASE_URL/signin" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"wrongpass\"}")

echo "$INVALID_RESPONSE" | grep -q "Invalid credentials" && echo "  PASS: Invalid password rejected" || { echo "  FAIL: Should reject invalid password"; exit 1; }
echo ""

# Test 5: NIP-05 Verification
echo "✓ Test 5: NIP-05 Verification"
NIP05_RESPONSE=$(curl -s "$BASE_URL/.well-known/nostr.json?name=$TEST_USER")

echo "$NIP05_RESPONSE" | grep -q "$PUBLIC_KEY" && echo "  PASS: NIP-05 verification works" || { echo "  FAIL: NIP-05 failed"; echo "$NIP05_RESPONSE"; exit 1; }
echo ""

# Test 6: Duplicate Username
echo "✓ Test 6: Duplicate Username"
DUPLICATE_RESPONSE=$(curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\",\"publicKey\":\"$PUBLIC_KEY\",\"encryptedPrivateKey\":\"$ENC_KEY\"}")

echo "$DUPLICATE_RESPONSE" | grep -q "already taken" && echo "  PASS: Duplicate username rejected" || { echo "  FAIL: Should reject duplicate"; exit 1; }
echo ""

# Test 7: Invalid Username Format
echo "✓ Test 7: Invalid Username Format"
INVALID_USER_RESPONSE=$(curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"Invalid-User\",\"password\":\"$TEST_PASS\",\"publicKey\":\"$PUBLIC_KEY\",\"encryptedPrivateKey\":\"$ENC_KEY\"}")

echo "$INVALID_USER_RESPONSE" | grep -q "lowercase" && echo "  PASS: Invalid username format rejected" || { echo "  FAIL: Should reject invalid format"; exit 1; }
echo ""

echo "================================"
echo "✅ All integration tests passed!"
echo "Tested user: $TEST_USER"
