#!/bin/bash
# Integration Test Script for Noas API
# Tests all endpoints with actual HTTP requests

set -uo pipefail

BASE_URL="http://localhost:3000"
VERBOSE=false
EXPECTED_TESTS=12
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
CURRENT_TEST=""
SUMMARY_PRINTED=false

if [ -t 1 ]; then
  COLOR_RESET=$'\033[0m'
  COLOR_BOLD=$'\033[1m'
  COLOR_DIM=$'\033[2m'
  COLOR_RED=$'\033[31m'
  COLOR_GREEN=$'\033[32m'
  COLOR_YELLOW=$'\033[33m'
  COLOR_BLUE=$'\033[34m'
  COLOR_CYAN=$'\033[36m'
else
  COLOR_RESET=""
  COLOR_BOLD=""
  COLOR_DIM=""
  COLOR_RED=""
  COLOR_GREEN=""
  COLOR_YELLOW=""
  COLOR_BLUE=""
  COLOR_CYAN=""
fi

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
TEST_PICTURE_BASE64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XG1cAAAAASUVORK5CYII="
TEST_PICTURE_CONTENT_TYPE="image/png"

sha256_hex() {
  if command -v shasum >/dev/null 2>&1; then printf '%s' "$1" | shasum -a 256 | awk '{print $1}'; return; fi
  if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum | awk '{print $1}'; return; fi
  printf '%s' "$1" | openssl dgst -sha256 -r | awk '{print $1}'
}

base64_file() {
  local file_path="$1"
  if command -v base64 >/dev/null 2>&1; then
    base64 < "$file_path" | tr -d '\n'
    return
  fi
  openssl base64 -A -in "$file_path"
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
  if printf '%s' "$response" | grep -qi "unverified_email"; then
    fail_step "Registration returned unverified_email" "Disable email verification for this test run to allow direct sign-in."
  fi
  if echo "$response" | grep -q "success"; then
    pass_step "$label"
  else
    fail_step "$label" "$response"
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
    printf "   ${COLOR_DIM}↳ response:${COLOR_RESET} %s\n" "$1"
  fi
}

print_banner() {
  printf "%s🧪 Noas API Integration Tests%s\n" "$COLOR_BOLD$COLOR_CYAN" "$COLOR_RESET"
  printf "%s================================%s\n\n" "$COLOR_DIM" "$COLOR_RESET"
}

start_test() {
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  CURRENT_TEST="$1"
  printf "%s[%02d/%02d]%s %s🔎 %s%s\n" \
    "$COLOR_BOLD$COLOR_BLUE" \
    "$TOTAL_TESTS" \
    "$EXPECTED_TESTS" \
    "$COLOR_RESET" \
    "$COLOR_BOLD" \
    "$CURRENT_TEST" \
    "$COLOR_RESET"
}

pass_step() {
  PASSED_TESTS=$((PASSED_TESTS + 1))
  printf "   %s✅ PASS:%s %s\n\n" "$COLOR_GREEN" "$COLOR_RESET" "$1"
}

fail_step() {
  FAILED_TESTS=$((FAILED_TESTS + 1))
  printf "   %s❌ FAIL:%s %s\n" "$COLOR_RED" "$COLOR_RESET" "$1"
  if [ -n "${2:-}" ]; then
    printf "   %s↳ details:%s %s\n" "$COLOR_YELLOW" "$COLOR_RESET" "$2"
  fi
  echo ""
  exit 1
}

print_summary() {
  [ "$SUMMARY_PRINTED" = true ] && return
  SUMMARY_PRINTED=true

  printf "%s================================%s\n" "$COLOR_DIM" "$COLOR_RESET"
  printf "%s📊 Test Summary%s\n" "$COLOR_BOLD$COLOR_CYAN" "$COLOR_RESET"
  printf "   %sPassed:%s %d\n" "$COLOR_GREEN" "$COLOR_RESET" "$PASSED_TESTS"
  printf "   %sFailed:%s %d\n" "$COLOR_RED" "$COLOR_RESET" "$FAILED_TESTS"
  printf "   %sTotal:%s  %d\n" "$COLOR_BOLD" "$COLOR_RESET" "$TOTAL_TESTS"
  if [ "$FAILED_TESTS" -eq 0 ]; then
    printf "   %sResult:%s all integration tests passed\n" "$COLOR_GREEN" "$COLOR_RESET"
    printf "   %sTested user:%s %s\n" "$COLOR_DIM" "$COLOR_RESET" "$TEST_USER"
  else
    printf "   %sResult:%s stopped on failure" "$COLOR_RED" "$COLOR_RESET"
    if [ -n "$CURRENT_TEST" ]; then
      printf " (%s)" "$CURRENT_TEST"
    fi
    printf "\n"
  fi
}

trap print_summary EXIT

print_banner

start_test "Health Check"
HEALTH_RESPONSE=$(curl -s "$BASE_URL/health")
print_response "$HEALTH_RESPONSE"
if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
  pass_step "Server is healthy"
else
  fail_step "Health check failed" "$HEALTH_RESPONSE"
fi

printf "%s🌐 Resolving API base%s\n" "$COLOR_BOLD$COLOR_CYAN" "$COLOR_RESET"
API_URL=$(curl -s "$BASE_URL/.well-known/nostr.json" | jq -r '.noas.api_base // empty' || true)
API_URL=${API_URL:-"$BASE_URL/api/v1"}
TEST_PASS_HASH=$(sha256_hex "$TEST_PASS")
WRONG_PASS_HASH=$(sha256_hex "wrongpass")
printf "   %s↳ API URL:%s %s\n\n" "$COLOR_DIM" "$COLOR_RESET" "$API_URL"

start_test "Register User Without Key"
REGISTER_RESPONSE=$(post_json "/auth/register" "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}")
assert_active_registration "$REGISTER_RESPONSE" "User registered"
echo ""

start_test "Sign In With Password Hash"
SIGNIN_RESPONSE=$(post_json "/auth/signin" "{\"username\":\"$TEST_USER\",\"password_hash\":\"$TEST_PASS_HASH\"}")
print_response "$SIGNIN_RESPONSE"
RETURNED_PUBLIC_KEY=$(jq -r '.public_key // empty' <<<"$SIGNIN_RESPONSE")
RETURNED_PRIVATE_KEY_ENCRYPTED=$(jq -r '.private_key_encrypted // empty' <<<"$SIGNIN_RESPONSE")
if [ -n "$RETURNED_PUBLIC_KEY" ] && [ -n "$RETURNED_PRIVATE_KEY_ENCRYPTED" ]; then
  pass_step "Sign in returned key material"
else
  fail_step "Sign in failed" "$SIGNIN_RESPONSE"
fi

start_test "Validate Returned Key"
if verify_returned_keypair "$RETURNED_PUBLIC_KEY" "$RETURNED_PRIVATE_KEY_ENCRYPTED" "$TEST_PASS"; then
  pass_step "Returned encrypted key matches returned public key"
else
  fail_step "Returned encrypted key is invalid"
fi

start_test "Register User With Returned Key"
REGISTER_WITH_KEY_RESPONSE=$(post_json "/auth/register" "{\"username\":\"$TEST_USER_WITH_KEY\",\"password_hash\":\"$TEST_PASS_HASH\",\"public_key\":\"$RETURNED_PUBLIC_KEY\",\"private_key_encrypted\":\"$RETURNED_PRIVATE_KEY_ENCRYPTED\"}")
assert_active_registration "$REGISTER_WITH_KEY_RESPONSE" "User registered with provided key"
echo ""

start_test "Sign In With Password Hash For Provided Key"
SIGNIN_WITH_KEY_RESPONSE=$(post_json "/auth/signin" "{\"username\":\"$TEST_USER_WITH_KEY\",\"password_hash\":\"$TEST_PASS_HASH\"}")

print_response "$SIGNIN_WITH_KEY_RESPONSE"
SIGNIN_WITH_KEY_PUBLIC_KEY=$(jq -r '.public_key // empty' <<<"$SIGNIN_WITH_KEY_RESPONSE")
SIGNIN_WITH_KEY_PRIVATE_KEY_ENCRYPTED=$(jq -r '.private_key_encrypted // empty' <<<"$SIGNIN_WITH_KEY_RESPONSE")
if [ "$SIGNIN_WITH_KEY_PUBLIC_KEY" = "$RETURNED_PUBLIC_KEY" ] && [ "$SIGNIN_WITH_KEY_PRIVATE_KEY_ENCRYPTED" = "$RETURNED_PRIVATE_KEY_ENCRYPTED" ]; then
  verify_returned_keypair "$SIGNIN_WITH_KEY_PUBLIC_KEY" "$SIGNIN_WITH_KEY_PRIVATE_KEY_ENCRYPTED" "$TEST_PASS" || fail_step "Provided key is invalid after sign in"
  pass_step "Sign in returned the provided key material and it remained valid"
else
  fail_step "Sign in did not return the provided key material" "$SIGNIN_WITH_KEY_RESPONSE"
fi

start_test "Invalid Password Hash"
INVALID_RESPONSE=$(post_json "/auth/signin" "{\"username\":\"$TEST_USER\",\"password_hash\":\"$WRONG_PASS_HASH\"}")

print_response "$INVALID_RESPONSE"
if echo "$INVALID_RESPONSE" | grep -q "Invalid credentials"; then
  pass_step "Invalid password rejected"
else
  fail_step "Should reject invalid password" "$INVALID_RESPONSE"
fi

start_test "NIP-05 Verification"
NIP05_RESPONSE=$(curl -s "$BASE_URL/.well-known/nostr.json?name=$TEST_USER")

print_response "$NIP05_RESPONSE"
if echo "$NIP05_RESPONSE" | grep -q "\"$TEST_USER\""; then
  pass_step "NIP-05 verification works"
else
  fail_step "NIP-05 failed" "$NIP05_RESPONSE"
fi

start_test "Upload Profile Picture"
PICTURE_UPLOAD_RESPONSE=$(post_json "/picture" "{\"username\":\"$TEST_USER\",\"password_hash\":\"$TEST_PASS_HASH\",\"data\":\"$TEST_PICTURE_BASE64\",\"contentType\":\"$TEST_PICTURE_CONTENT_TYPE\"}")
print_response "$PICTURE_UPLOAD_RESPONSE"
PICTURE_URL=$(jq -r '.url // empty' <<<"$PICTURE_UPLOAD_RESPONSE")
PICTURE_PUBLIC_KEY=$(jq -r '.public_key // empty' <<<"$PICTURE_UPLOAD_RESPONSE")
if echo "$PICTURE_UPLOAD_RESPONSE" | grep -q '"success"[[:space:]]*:[[:space:]]*true' && [ -n "$PICTURE_URL" ] && [ "$PICTURE_PUBLIC_KEY" = "$RETURNED_PUBLIC_KEY" ]; then
  pass_step "Profile picture uploaded and public URL returned"
else
  fail_step "Profile picture upload failed" "$PICTURE_UPLOAD_RESPONSE"
fi

start_test "Fetch Profile Picture"
PICTURE_HEADERS_FILE=$(mktemp)
PICTURE_BODY_FILE=$(mktemp)
PICTURE_304_HEADERS_FILE=$(mktemp)
PICTURE_304_BODY_FILE=$(mktemp)
trap 'rm -f "$PICTURE_HEADERS_FILE" "$PICTURE_BODY_FILE" "$PICTURE_304_HEADERS_FILE" "$PICTURE_304_BODY_FILE"; print_summary' EXIT
PICTURE_STATUS=$(curl -s -D "$PICTURE_HEADERS_FILE" -o "$PICTURE_BODY_FILE" -w "%{http_code}" "$API_URL/picture/$RETURNED_PUBLIC_KEY")
PICTURE_RESPONSE_CONTENT_TYPE=$(awk 'BEGIN{IGNORECASE=1} /^Content-Type:/ {gsub(/\r/, "", $2); print $2; exit}' "$PICTURE_HEADERS_FILE")
PICTURE_LAST_MODIFIED=$(awk 'BEGIN{IGNORECASE=1} /^Last-Modified:/ {$1=""; sub(/^ /, ""); gsub(/\r/, ""); print; exit}' "$PICTURE_HEADERS_FILE")
PICTURE_RESPONSE_BASE64=$(base64_file "$PICTURE_BODY_FILE")
if [ "$PICTURE_STATUS" = "200" ] && [ "$PICTURE_RESPONSE_CONTENT_TYPE" = "$TEST_PICTURE_CONTENT_TYPE" ] && [ "$PICTURE_RESPONSE_BASE64" = "$TEST_PICTURE_BASE64" ] && [ -n "$PICTURE_LAST_MODIFIED" ]; then
  pass_step "Profile picture fetch returned the stored image with Last-Modified"
else
  fail_step "Profile picture fetch failed" "status=$PICTURE_STATUS content_type=$PICTURE_RESPONSE_CONTENT_TYPE"
fi

start_test "Fetch Profile Picture Not Modified"
PICTURE_304_STATUS=$(curl -s -D "$PICTURE_304_HEADERS_FILE" -o "$PICTURE_304_BODY_FILE" -w "%{http_code}" -H "If-Modified-Since: $PICTURE_LAST_MODIFIED" "$API_URL/picture/$RETURNED_PUBLIC_KEY")
if [ "$PICTURE_304_STATUS" = "304" ]; then
  pass_step "Profile picture returned 304 for If-Modified-Since"
else
  fail_step "Profile picture conditional fetch failed" "status=$PICTURE_304_STATUS"
fi

start_test "Duplicate Username"
DUPLICATE_RESPONSE=$(post_json "/auth/register" "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}")

print_response "$DUPLICATE_RESPONSE"
if echo "$DUPLICATE_RESPONSE" | grep -Eq "already active|pending verification"; then
  pass_step "Duplicate username rejected"
else
  fail_step "Should reject duplicate" "$DUPLICATE_RESPONSE"
fi

start_test "Invalid Username Format"
INVALID_USER_RESPONSE=$(post_json "/auth/register" "{\"username\":\"Invalid-User\",\"password\":\"$TEST_PASS\"}")

print_response "$INVALID_USER_RESPONSE"
if echo "$INVALID_USER_RESPONSE" | grep -q "lowercase"; then
  pass_step "Invalid username format rejected"
else
  fail_step "Should reject invalid format" "$INVALID_USER_RESPONSE"
fi
