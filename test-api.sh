#!/bin/bash
# Integration Test Script for Noas API
# Tests all endpoints with actual HTTP requests

set -uo pipefail

BASE_URL="${NOAS_TEST_BASE_URL:-http://localhost:3000}"
VERBOSE=false
EXPECTED_TESTS=21
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
CURRENT_TEST=""
SUMMARY_PRINTED=false
SERVER_PID=""
USE_EXISTING_SERVER="${NOAS_TEST_USE_EXISTING_SERVER:-true}"
TEST_PORT="${NOAS_TEST_PORT:-3002}"

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
TEST_PICTURE_UPDATED_BASE64="R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
TEST_PICTURE_UPDATED_CONTENT_TYPE="image/gif"

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

url_encode() {
  local raw="${1:-}"
  NOAS_URL_ENCODE_INPUT="$raw" node --input-type=module <<'EOF'
const raw = String(process.env.NOAS_URL_ENCODE_INPUT || '');
process.stdout.write(encodeURIComponent(raw));
EOF
}

url_origin() {
  local raw="${1:-}"
  NOAS_URL_ORIGIN_INPUT="$raw" node --input-type=module <<'EOF'
const raw = String(process.env.NOAS_URL_ORIGIN_INPUT || '').trim();
if (!raw) {
  process.stdout.write('');
  process.exit(0);
}
try {
  const parsed = new URL(raw);
  process.stdout.write(parsed.origin);
} catch {
  process.stdout.write('');
}
EOF
}

fetch_verification_token_from_db() {
  local username="$1"
  local token
  local debug_file
  debug_file=$(mktemp)

  token=$(NOAS_LOAD_DOTENV=true NOAS_TEST_USERNAME="$username" node --input-type=module <<'EOF' 2>"$debug_file"
import { query, closePool } from './src/db/pool.js';

const username = String(process.env.NOAS_TEST_USERNAME || '').trim().toLowerCase();
if (!username) {
  console.log('');
  process.exit(0);
}

try {
  const result = await query(
    `SELECT verification_token
     FROM nostr_users
     WHERE username = $1
       AND verification_token IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [username]
  );
  const token = result.rows?.[0]?.verification_token || '';
  console.log(token ? String(token).trim() : '');
} catch {
  console.log('');
} finally {
  await closePool().catch(() => {});
}
EOF
)

  token=$(printf '%s' "$token" | tr -d '\r\n')
  if [ -n "$token" ]; then
    rm -f "$debug_file"
    printf '%s' "$token"
    return
  fi

  # Fallback: query via psql using DATABASE_URL from env or local .env.
  local db_url="${DATABASE_URL:-}"
  if [ -z "$db_url" ] && [ -f "./.env" ]; then
    db_url=$(awk -F= '/^DATABASE_URL=/{sub(/^DATABASE_URL=/,""); print; exit}' ./.env)
  fi

  if [ -n "$db_url" ] && command -v psql >/dev/null 2>&1; then
    token=$(psql "$db_url" -Atq -v ON_ERROR_STOP=1 -v username="$username" \
      -c "SELECT verification_token FROM nostr_users WHERE username = :'username' AND verification_token IS NOT NULL ORDER BY created_at DESC LIMIT 1;" \
      2>>"$debug_file" | tr -d '\r\n')
  fi

  # Docker fallback: resolve token inside running Noas container where DATABASE_URL is valid.
  if [ -z "$token" ] && command -v docker >/dev/null 2>&1; then
    local noas_container_id=""
    noas_container_id=$(docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' \
      | awk '/(^|[[:space:]])noas($|[[:space:]])/ {print $1; exit}')
    if [ -z "$noas_container_id" ]; then
      noas_container_id=$(docker ps --format '{{.ID}} {{.Ports}}' \
        | awk '/0\.0\.0\.0:3000->|:::3000->/ {print $1; exit}')
    fi
    if [ -n "$noas_container_id" ]; then
      token=$(docker exec -e NOAS_TEST_USERNAME="$username" "$noas_container_id" node --input-type=module -e "
import pg from 'pg';
const username = String(process.env.NOAS_TEST_USERNAME || '').trim().toLowerCase();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(
    'SELECT verification_token FROM nostr_users WHERE username = \$1 AND verification_token IS NOT NULL ORDER BY created_at DESC LIMIT 1',
    [username]
  );
  const token = result.rows?.[0]?.verification_token || '';
  process.stdout.write(token ? String(token).trim() : '');
} catch (error) {
  process.stderr.write(String(error?.message || error));
} finally {
  await pool.end().catch(() => {});
}
" 2>>"$debug_file" | tr -d '\r\n')
    fi
  fi

  if [ "$VERBOSE" = true ] && [ -s "$debug_file" ]; then
    printf "   ${COLOR_DIM}↳ token lookup debug:${COLOR_RESET} %s\n" "$(tail -n 5 "$debug_file" | tr '\n' ' ')" >&2
  fi
  rm -f "$debug_file"
  printf '%s' "$token"
}

assert_registration_and_activate() {
  local response="$1"
  local label="$2"
  local password_hash="$3"
  local username="$4"
  local expected_public_key="${5:-}"

  print_response "$response"
  if ! echo "$response" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
    fail_step "$label" "$response"
  fi

  local status
  status=$(jq -r '.status // empty' <<<"$response")

  if [ -n "$expected_public_key" ]; then
    local returned_public_key
    returned_public_key=$(jq -r '.public_key // empty' <<<"$response")
    if [ "$returned_public_key" != "$expected_public_key" ]; then
      fail_step "$label" "Registration returned unexpected public key: $returned_public_key"
    fi
  fi

  if [ "$status" = "active" ] || [ -z "$status" ]; then
    pass_step "$label"
    return
  fi

  if [ "$status" != "unverified_email" ]; then
    fail_step "$label" "Unexpected registration status: $status"
  fi

  local verification_token
  verification_token=$(jq -r '.verification_token // empty' <<<"$response")
  if [ -z "$verification_token" ]; then
    verification_token=$(fetch_verification_token_from_db "$username")
  fi
  if [ -z "$verification_token" ]; then
    local signin_probe
    signin_probe=$(post_json "/auth/signin" "{\"username\":\"$username\",\"password_hash\":\"$password_hash\"}")
    if echo "$signin_probe" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
      pass_step "$label"
      return
    fi
    fail_step "$label" "Registration requires verification but no verification_token was returned/readable. Run with EXPOSE_VERIFICATION_TOKEN_IN_RESPONSE=true or provide DB access for token lookup."
  fi
  if ! echo "$verification_token" | grep -Eq '^[0-9a-fA-F-]{36}$'; then
    fail_step "$label" "verification_token format is invalid: $verification_token"
  fi
  if [ "$VERBOSE" = true ]; then
    printf "   ${COLOR_DIM}↳ verification token:${COLOR_RESET} %s\n" "$verification_token"
  fi

  local preview_response
  preview_response=$(curl -s "$API_URL/auth/verify?token=$(url_encode "$verification_token")")
  if [ -z "$preview_response" ]; then
    fail_step "$label" "Verification preview returned an empty response for token $verification_token"
  fi
  print_response "$preview_response"
  if [ -n "$expected_public_key" ]; then
    local preview_public_key
    preview_public_key=$(jq -r '.public_key // empty' <<<"$preview_response")
    if [ "$preview_public_key" != "$expected_public_key" ]; then
      fail_step "$label" "Verification preview public key mismatch: $preview_public_key"
    fi
  fi
  local preview_registration_email
  preview_registration_email=$(jq -r '.registration_email // empty' <<<"$preview_response")
  if [ -n "$preview_registration_email" ]; then
    if ! echo "$preview_registration_email" | grep -q '@'; then
      fail_step "$label" "Verification preview registration_email looks invalid: $preview_registration_email"
    fi
  fi

  local verify_response
  local verify_payload
  verify_payload=$(jq -nc \
    --arg token "$verification_token" \
    --arg password_hash "$password_hash" \
    '{token: $token, password_hash: $password_hash}')
  verify_response=$(post_json "/auth/verify" "$verify_payload")
  print_response "$verify_response"
  if echo "$verify_response" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
    local relay_allow_attempted
    relay_allow_attempted=$(jq -r '.relay_allow.attempted // empty' <<<"$verify_response")
    local relay_allow_total
    relay_allow_total=$(jq -r '.relay_allow.relays_total // empty' <<<"$verify_response")
    local relay_allow_success
    relay_allow_success=$(jq -r '.relay_allow.relays_success // empty' <<<"$verify_response")
    local relay_allow_failed
    relay_allow_failed=$(jq -r '.relay_allow.relays_failed // empty' <<<"$verify_response")
    if [ -z "$relay_allow_attempted" ] || [ -z "$relay_allow_total" ] || [ -z "$relay_allow_success" ] || [ -z "$relay_allow_failed" ]; then
      fail_step "$label" "Verification response missing relay_allow summary: $verify_response"
    fi

    local verify_again_response
    verify_again_response=$(post_json "/auth/verify" "$verify_payload")
    print_response "$verify_again_response"
    if echo "$verify_again_response" | grep -q 'Account already active\. Sign in\.'; then
      pass_step "$label"
      return
    fi
    fail_step "$label" "Second verification attempt should report already active: $verify_again_response"
  fi
  fail_step "$label" "Verification failed: $verify_response"
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

rotate_key_password() {
  local private_key_encrypted="$1"
  local old_password="$2"
  local new_password="$3"

  PRIVATE_KEY_ENCRYPTED="$private_key_encrypted" \
  OLD_PASSWORD="$old_password" \
  NEW_PASSWORD="$new_password" \
  node --input-type=module <<'EOF'
import { getPublicKey } from 'nostr-tools';
import { decrypt, encrypt } from 'nostr-tools/nip49';

const privateKeyEncrypted = String(process.env.PRIVATE_KEY_ENCRYPTED || '').trim();
const oldPassword = String(process.env.OLD_PASSWORD || '');
const newPassword = String(process.env.NEW_PASSWORD || '');

const secretKey = decrypt(privateKeyEncrypted, oldPassword);
const publicKey = getPublicKey(secretKey).toLowerCase();
const rotatedPrivateKeyEncrypted = encrypt(secretKey, newPassword);

console.log(publicKey);
console.log(rotatedPrivateKeyEncrypted);
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

cleanup_server() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

wait_for_health() {
  local target_url="${1:-$BASE_URL}"
  local attempts=0
  while [ $attempts -lt 30 ]; do
    HEALTH_RESPONSE=$(curl -s "$target_url/health" || true)
    if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

start_local_server_if_needed() {
  if [ "$USE_EXISTING_SERVER" = "true" ]; then
    if wait_for_health "$BASE_URL"; then
      return 0
    fi
    fail_step "Health check failed" "Configured existing server is not reachable at $BASE_URL"
  fi

  local startup_log_file="/tmp/noas-test-api.log"
  rm -f "$startup_log_file"

  printf "   %s↳ starting isolated local Noas test server on port %s%s\n" "$COLOR_DIM" "$TEST_PORT" "$COLOR_RESET"
  PORT="$TEST_PORT" \
  REQUIRE_EMAIL_DELIVERY=false \
  EXPOSE_VERIFICATION_TOKEN_IN_RESPONSE=true \
  EMAIL_VERIFICATION_MODE=required_nip05_domains \
  NOAS_LOAD_DOTENV=true \
  node src/index.js >"$startup_log_file" 2>&1 &
  SERVER_PID=$!
  BASE_URL="http://localhost:$TEST_PORT"

  if wait_for_health "$BASE_URL"; then
    return 0
  fi

  local startup_log=""
  if [ -f "$startup_log_file" ]; then
    startup_log=$(tail -n 20 "$startup_log_file")
  fi
  fail_step "Health check failed" "Unable to start local server. ${startup_log}"
}

trap 'cleanup_server; print_summary' EXIT

print_banner

start_test "Health Check"
start_local_server_if_needed
print_response "$HEALTH_RESPONSE"
if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
  pass_step "Server is healthy"
else
  fail_step "Health check failed" "$HEALTH_RESPONSE"
fi

printf "%s🌐 Resolving API base%s\n" "$COLOR_BOLD$COLOR_CYAN" "$COLOR_RESET"
DISCOVERED_API_URL=$(curl -s "$BASE_URL/.well-known/nostr.json" | jq -r '.noas.api_base // empty' || true)
API_URL=${NOAS_TEST_API_URL:-$DISCOVERED_API_URL}
if [ -z "$API_URL" ]; then
  API_URL="$BASE_URL/api/v1"
fi

BASE_ORIGIN=$(url_origin "$BASE_URL")
API_ORIGIN=$(url_origin "$API_URL")
if [ -z "${NOAS_TEST_TRUST_DISCOVERED_API_BASE:-}" ] && [ -n "$BASE_ORIGIN" ] && [ -n "$API_ORIGIN" ] && [ "$BASE_ORIGIN" != "$API_ORIGIN" ] && [ -z "${NOAS_TEST_API_URL:-}" ]; then
  API_URL="$BASE_URL/api/v1"
  printf "   %s↳ discovered api_base origin (%s) differs from base (%s), using local API URL%s\n" "$COLOR_DIM" "$API_ORIGIN" "$BASE_ORIGIN" "$COLOR_RESET"
fi

TEST_PASS_HASH=$(sha256_hex "$TEST_PASS")
WRONG_PASS_HASH=$(sha256_hex "wrongpass")
printf "   %s↳ API URL:%s %s\n\n" "$COLOR_DIM" "$COLOR_RESET" "$API_URL"

start_test "Register User Without Key"
REGISTER_RESPONSE=$(post_json "/auth/register" "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\",\"profile_picture_data\":\"$TEST_PICTURE_BASE64\",\"profile_picture_content_type\":\"$TEST_PICTURE_CONTENT_TYPE\"}")
assert_registration_and_activate "$REGISTER_RESPONSE" "User registered" "$TEST_PASS_HASH" "$TEST_USER"
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
assert_registration_and_activate "$REGISTER_WITH_KEY_RESPONSE" "User registered with provided key" "$TEST_PASS_HASH" "$TEST_USER_WITH_KEY" "$RETURNED_PUBLIC_KEY"
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

start_test "Rotate Password And Key Together"
ROTATED_TEST_PASS="testpass456"
ROTATED_TEST_PASS_HASH=$(sha256_hex "$ROTATED_TEST_PASS")
ROTATED_KEY_OUTPUT=$(rotate_key_password "$SIGNIN_WITH_KEY_PRIVATE_KEY_ENCRYPTED" "$TEST_PASS" "$ROTATED_TEST_PASS")
ROTATED_PUBLIC_KEY=$(printf '%s\n' "$ROTATED_KEY_OUTPUT" | sed -n '1p')
ROTATED_PRIVATE_KEY_ENCRYPTED=$(printf '%s\n' "$ROTATED_KEY_OUTPUT" | sed -n '2p')
UPDATE_CREDENTIALS_RESPONSE=$(post_json "/auth/update" "{\"username\":\"$TEST_USER_WITH_KEY\",\"password_hash\":\"$TEST_PASS_HASH\",\"updates\":{\"new_password_hash\":\"$ROTATED_TEST_PASS_HASH\",\"public_key\":\"$ROTATED_PUBLIC_KEY\",\"private_key_encrypted\":\"$ROTATED_PRIVATE_KEY_ENCRYPTED\"}}")
print_response "$UPDATE_CREDENTIALS_RESPONSE"
if echo "$UPDATE_CREDENTIALS_RESPONSE" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
  pass_step "Password, pubkey, and encrypted key rotated together"
else
  fail_step "Credential rotation failed" "$UPDATE_CREDENTIALS_RESPONSE"
fi

start_test "Sign In With Rotated Credentials"
ROTATED_SIGNIN_RESPONSE=$(post_json "/auth/signin" "{\"username\":\"$TEST_USER_WITH_KEY\",\"password_hash\":\"$ROTATED_TEST_PASS_HASH\"}")
print_response "$ROTATED_SIGNIN_RESPONSE"
ROTATED_SIGNIN_PUBLIC_KEY=$(jq -r '.public_key // empty' <<<"$ROTATED_SIGNIN_RESPONSE")
ROTATED_SIGNIN_PRIVATE_KEY_ENCRYPTED=$(jq -r '.private_key_encrypted // empty' <<<"$ROTATED_SIGNIN_RESPONSE")
if [ "$ROTATED_SIGNIN_PUBLIC_KEY" = "$ROTATED_PUBLIC_KEY" ] && [ "$ROTATED_SIGNIN_PRIVATE_KEY_ENCRYPTED" = "$ROTATED_PRIVATE_KEY_ENCRYPTED" ]; then
  verify_returned_keypair "$ROTATED_SIGNIN_PUBLIC_KEY" "$ROTATED_SIGNIN_PRIVATE_KEY_ENCRYPTED" "$ROTATED_TEST_PASS" || fail_step "Rotated key is invalid after sign in"
  pass_step "Rotated credentials sign in successfully"
else
  fail_step "Sign in did not return the rotated credentials" "$ROTATED_SIGNIN_RESPONSE"
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

start_test "NIP-46 Info"
NIP46_INFO_RESPONSE=$(curl -s "$API_URL/nip46/info")
print_response "$NIP46_INFO_RESPONSE"
if echo "$NIP46_INFO_RESPONSE" | grep -q '"pubkey"' && echo "$NIP46_INFO_RESPONSE" | grep -q '"connect"'; then
  pass_step "NIP-46 info endpoint returned signer metadata"
else
  fail_step "NIP-46 info failed" "$NIP46_INFO_RESPONSE"
fi

start_test "NIP-46 Connect Token"
NIP46_CONNECT_RESPONSE=$(curl -s "$API_URL/nip46/connect/$TEST_USER")
print_response "$NIP46_CONNECT_RESPONSE"
NIP46_BUNKER_URL=$(jq -r '.bunker_url // empty' <<<"$NIP46_CONNECT_RESPONSE")
if [ -n "$NIP46_BUNKER_URL" ] && printf '%s' "$NIP46_BUNKER_URL" | grep -q '^bunker://'; then
  pass_step "NIP-46 connect returned a bunker URL"
else
  fail_step "NIP-46 connect failed" "$NIP46_CONNECT_RESPONSE"
fi

start_test "NIP-46 Nostrconnect"
NIP46_NOSTRCONNECT_RESPONSE=$(post_json "/nip46/nostrconnect" "{\"nostrconnect_url\":\"nostrconnect://$(printf 'c%.0s' $(seq 1 64))?relay=wss://relay.example.com&secret=test123&perms=sign_event,get_public_key\",\"username\":\"$TEST_USER\"}")
print_response "$NIP46_NOSTRCONNECT_RESPONSE"
if echo "$NIP46_NOSTRCONNECT_RESPONSE" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
  pass_step "NIP-46 nostrconnect established a session"
else
  fail_step "NIP-46 nostrconnect failed" "$NIP46_NOSTRCONNECT_RESPONSE"
fi

start_test "Fetch Profile Picture From Registration"
PICTURE_REG_HEADERS_FILE=$(mktemp)
PICTURE_REG_BODY_FILE=$(mktemp)
trap 'rm -f "${PICTURE_HEADERS_FILE:-}" "${PICTURE_BODY_FILE:-}" "${PICTURE_304_HEADERS_FILE:-}" "${PICTURE_304_BODY_FILE:-}" "${PICTURE_BY_NAME_HEADERS_FILE:-}" "${PICTURE_BY_NAME_BODY_FILE:-}" "${PICTURE_REG_HEADERS_FILE:-}" "${PICTURE_REG_BODY_FILE:-}"; print_summary' EXIT
PICTURE_REG_STATUS=$(curl -s -D "$PICTURE_REG_HEADERS_FILE" -o "$PICTURE_REG_BODY_FILE" -w "%{http_code}" "$API_URL/picture/$RETURNED_PUBLIC_KEY")
PICTURE_REG_CONTENT_TYPE=$(awk 'BEGIN{IGNORECASE=1} /^Content-Type:/ {gsub(/\r/, "", $2); print $2; exit}' "$PICTURE_REG_HEADERS_FILE")
PICTURE_REG_BASE64=$(base64_file "$PICTURE_REG_BODY_FILE")
if [ "$PICTURE_REG_STATUS" = "200" ] && [ "$PICTURE_REG_CONTENT_TYPE" = "$TEST_PICTURE_CONTENT_TYPE" ] && [ "$PICTURE_REG_BASE64" = "$TEST_PICTURE_BASE64" ]; then
  pass_step "Profile picture from registration is stored and readable"
else
  fail_step "Profile picture from registration failed" "status=$PICTURE_REG_STATUS content_type=$PICTURE_REG_CONTENT_TYPE"
fi

start_test "Update Profile Picture Via /auth/update"
PICTURE_UPLOAD_RESPONSE=$(post_json "/auth/update" "{\"username\":\"$TEST_USER\",\"password_hash\":\"$TEST_PASS_HASH\",\"updates\":{\"profile_picture_data\":\"$TEST_PICTURE_UPDATED_BASE64\",\"profile_picture_content_type\":\"$TEST_PICTURE_UPDATED_CONTENT_TYPE\"}}")
print_response "$PICTURE_UPLOAD_RESPONSE"
PICTURE_URL=$(jq -r '.picture_url // empty' <<<"$PICTURE_UPLOAD_RESPONSE")
if echo "$PICTURE_UPLOAD_RESPONSE" | grep -q '"success"[[:space:]]*:[[:space:]]*true' && [ -n "$PICTURE_URL" ]; then
  pass_step "Profile picture updated through /auth/update"
else
  fail_step "Profile picture update through /auth/update failed" "$PICTURE_UPLOAD_RESPONSE"
fi

start_test "POST /picture Is Not Available"
LEGACY_PICTURE_UPLOAD_STATUS=$(curl -s -o /tmp/noas_legacy_picture.out -w "%{http_code}" -X POST "$API_URL/picture" -H "Content-Type: application/json" -d "{\"username\":\"$TEST_USER\",\"password_hash\":\"$TEST_PASS_HASH\",\"data\":\"$TEST_PICTURE_BASE64\",\"content_type\":\"$TEST_PICTURE_CONTENT_TYPE\"}")
if [ "$LEGACY_PICTURE_UPLOAD_STATUS" = "404" ]; then
  pass_step "Legacy profile picture upload endpoint is not available"
else
  fail_step "Legacy profile picture upload endpoint should not be available" "status=$LEGACY_PICTURE_UPLOAD_STATUS"
fi

start_test "Fetch Profile Picture"
PICTURE_HEADERS_FILE=$(mktemp)
PICTURE_BODY_FILE=$(mktemp)
PICTURE_304_HEADERS_FILE=$(mktemp)
PICTURE_304_BODY_FILE=$(mktemp)
trap 'rm -f "${PICTURE_HEADERS_FILE:-}" "${PICTURE_BODY_FILE:-}" "${PICTURE_304_HEADERS_FILE:-}" "${PICTURE_304_BODY_FILE:-}" "${PICTURE_BY_NAME_HEADERS_FILE:-}" "${PICTURE_BY_NAME_BODY_FILE:-}" "${PICTURE_REG_HEADERS_FILE:-}" "${PICTURE_REG_BODY_FILE:-}"; print_summary' EXIT
PICTURE_STATUS=$(curl -s -D "$PICTURE_HEADERS_FILE" -o "$PICTURE_BODY_FILE" -w "%{http_code}" "$API_URL/picture/$RETURNED_PUBLIC_KEY")
PICTURE_RESPONSE_CONTENT_TYPE=$(awk 'BEGIN{IGNORECASE=1} /^Content-Type:/ {gsub(/\r/, "", $2); print $2; exit}' "$PICTURE_HEADERS_FILE")
PICTURE_LAST_MODIFIED=$(awk 'BEGIN{IGNORECASE=1} /^Last-Modified:/ {$1=""; sub(/^ /, ""); gsub(/\r/, ""); print; exit}' "$PICTURE_HEADERS_FILE")
PICTURE_RESPONSE_BASE64=$(base64_file "$PICTURE_BODY_FILE")
if [ "$PICTURE_STATUS" = "200" ] && [ "$PICTURE_RESPONSE_CONTENT_TYPE" = "$TEST_PICTURE_UPDATED_CONTENT_TYPE" ] && [ "$PICTURE_RESPONSE_BASE64" = "$TEST_PICTURE_UPDATED_BASE64" ] && [ -n "$PICTURE_LAST_MODIFIED" ]; then
  pass_step "Profile picture fetch returned the stored image with Last-Modified"
else
  fail_step "Profile picture fetch failed" "status=$PICTURE_STATUS content_type=$PICTURE_RESPONSE_CONTENT_TYPE"
fi

start_test "Fetch Profile Picture By Username"
PICTURE_BY_NAME_HEADERS_FILE=$(mktemp)
PICTURE_BY_NAME_BODY_FILE=$(mktemp)
trap 'rm -f "${PICTURE_HEADERS_FILE:-}" "${PICTURE_BODY_FILE:-}" "${PICTURE_304_HEADERS_FILE:-}" "${PICTURE_304_BODY_FILE:-}" "${PICTURE_BY_NAME_HEADERS_FILE:-}" "${PICTURE_BY_NAME_BODY_FILE:-}" "${PICTURE_REG_HEADERS_FILE:-}" "${PICTURE_REG_BODY_FILE:-}"; print_summary' EXIT
PICTURE_BY_NAME_STATUS=$(curl -s -D "$PICTURE_BY_NAME_HEADERS_FILE" -o "$PICTURE_BY_NAME_BODY_FILE" -w "%{http_code}" "$API_URL/picture/$TEST_USER")
PICTURE_BY_NAME_CONTENT_TYPE=$(awk 'BEGIN{IGNORECASE=1} /^Content-Type:/ {gsub(/\r/, "", $2); print $2; exit}' "$PICTURE_BY_NAME_HEADERS_FILE")
PICTURE_BY_NAME_BASE64=$(base64_file "$PICTURE_BY_NAME_BODY_FILE")
if [ "$PICTURE_BY_NAME_STATUS" = "200" ] && [ "$PICTURE_BY_NAME_CONTENT_TYPE" = "$TEST_PICTURE_UPDATED_CONTENT_TYPE" ] && [ "$PICTURE_BY_NAME_BASE64" = "$TEST_PICTURE_UPDATED_BASE64" ]; then
  pass_step "Profile picture fetched by username"
else
  fail_step "Profile picture fetch by username failed" "status=$PICTURE_BY_NAME_STATUS content_type=$PICTURE_BY_NAME_CONTENT_TYPE"
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
INVALID_USER_RESPONSE=$(post_json "/auth/register" "{\"username\":\"invalid!user\",\"password\":\"$TEST_PASS\"}")

print_response "$INVALID_USER_RESPONSE"
if echo "$INVALID_USER_RESPONSE" | grep -qi '"error"' && echo "$INVALID_USER_RESPONSE" | grep -qi "username"; then
  pass_step "Invalid username format rejected"
else
  fail_step "Should reject invalid format" "$INVALID_USER_RESPONSE"
fi
