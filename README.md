# Noas - Nostr Authentication Server

Simple username-password authentication server for Nostr with NIP-05 verification.

## Features

- Secure two-step onboarding (verify email before private key submission)
- Secure password hashing (bcrypt)
- NIP-49 encrypted private key storage
- NIP-05 verification endpoint
- Update password and relays
- Test coverage

## Setup

Runtime config model:
- Docker: `docker-compose.yml` is the runtime source of truth (`NOAS_LOAD_DOTENV=false`).
- Local `npm run dev`: `.env` is used (`NOAS_LOAD_DOTENV=true`).

### Task runner (`justfile`)

This project includes a [`justfile`](./justfile) with common development commands
for setup, database lifecycle, testing, demos, and health checks.

If you have [`just`](https://github.com/casey/just) installed, you can list all
available recipes with:

```bash
just --list
```

Common examples:

```bash
# One-time local setup (install deps + start DB + apply schema)
just setup

# Run API in dev mode
just dev

# Unit tests
just test

# Integration tests (server must already be running)
just test-integration
```

### 1. Install dependencies

```bash
npm install
```

### 2. Configure database

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your PostgreSQL connection string:

```
DATABASE_URL=postgresql://user:password@localhost:5432/noas
DOMAIN=yourdomain.com
PORT=3000
REQUIRE_EMAIL_VERIFICATION=true
EMAIL_VERIFICATION_ENABLED=true
VERIFICATION_EXPIRY_MINUTES=15
RESEND_COOLDOWN_MINUTES=1
NIP05_DOMAIN=polygon.gmbh
NOAS_PUBLIC_URL=https://noas.polygon.gmbh
NOAS_BASE_PATH=/noas
ALLOWED_ORIGINS=https://nodex.polygon.gmbh,https://polygon.gmbh
ALLOWED_SIGNUP_EMAIL_DOMAIN=
TENANT_DEFAULT_RELAYS=
DOMAIN_RELAY_MAP=polygon.gmbh=wss://tasks.polygon.gmbh
EMAIL_VERIFICATION_TOKEN_TTL_MINUTES=30
EXPOSE_VERIFICATION_TOKEN_IN_RESPONSE=false
REQUIRE_EMAIL_DELIVERY=false
SMTP_URL=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Noas <no-reply@example.com>"
SMTP_REPLY_TO=
SMTP_REJECT_UNAUTHORIZED=true
```

Primary domain settings:
- `NIP05_DOMAIN`: base identity domain for NIP-05 handles (`user@polygon.gmbh`)
- `NOAS_PUBLIC_URL`: public Noas URL where users access verify/UI/API

Most other domain-related behavior derives from these values.

### 3. Set up database

```bash
npm run db:setup
```

### 4. Run tests

```bash
# Unit tests (auth, validation, database)
npm run test:unit

# Or all tests
npm test

# Watch mode
npm run test:watch
```

### 5. Start server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

## API Endpoints

### POST /api/v1/auth/register

Create account and send verification email.

**Request:**
```json
{
  "username": "alice",
  "password_hash": "sha256_hex_of_password",
  "public_key": "npub1...",
  "private_key_encrypted": "ncryptsec1...",
  "redirect": "https://nodex.polygon.gmbh"
}
```

**Response:**
```json
{
  "success": true,
  "status": "unverified_email",
  "nip05": "alice@polygon.gmbh",
  "message": "Check alice@polygon.gmbh to verify your account."
}
```

If SMTP is configured, Noas sends a verification link to `username@NIP05_DOMAIN`.  
If SMTP is not configured, verification-only dev mode works with `EXPOSE_VERIFICATION_TOKEN_IN_RESPONSE=true`.  
Set `REQUIRE_EMAIL_DELIVERY=true` to fail onboarding when mail cannot be delivered.

Primary auth endpoints (v1.3):

- `POST /api/v1/auth/register` -> creates unverified account and sends verification email.
- `GET /api/v1/auth/verify?token=...` -> previews verification link state.
- `POST /api/v1/auth/verify` -> verifies token + password hash and activates account.
- `POST /api/v1/auth/resend` -> resends verification email with cooldown.

### POST /api/v1/auth/verify

Activate account by confirming token + password hash.

**Request:**
```json
{
  "token": "<verification_token>",
  "password_hash": "sha256_hex_of_password"
}
```

### POST /api/v1/auth/resend

Resend verification email for a pending account.

```json
{
  "username": "alice"
}
```

### POST /register

Deprecated legacy endpoint. Returns `410 Gone`. Use `POST /api/v1/auth/register`.

### POST /signin

Sign in and retrieve encrypted private key (active accounts only).

**Request:**
```json
{
  "username": "alice",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "success": true,
  "encryptedPrivateKey": "ncryptsec1...",
  "publicKey": "a0b1c2d3...",
  "relays": ["wss://relay.example.com"]
}
```

### POST /update

Update password hash, encrypted private key, or relays (requires authentication).

**Request:**
```json
{
  "username": "alice",
  "password": "currentpassword",
  "updates": {
    "newPasswordHash": "sha256_hex_of_new_password",
    "encryptedPrivateKey": "ncryptsec1...",
    "relays": ["wss://new-relay.com"]
  }
}
```

### GET /.well-known/nostr.json?name=alice

NIP-05 verification endpoint.

**Response:**
```json
{
  "names": {
    "alice": "a0b1c2d3..."
  }
}
```

When called without `name`, returns Noas instance metadata (version, public URL, API base, and NIP-05 domain) for client discovery.

## Security Notes

- Passwords are hashed with bcrypt (never stored plain)
- Private keys are stored encrypted (NIP-49 format)
- Private key is only accepted after successful email verification
- Uses HTTPS in production
- Username validation: 3-32 chars, lowercase alphanumeric + underscore
- Username can be independent from email local-part (must still be unique and valid format)
- Optional email verification gate before sign-in (`EMAIL_VERIFICATION_ENABLED=true`)
- When email verification is enabled, NIP-05 lookups only expose verified users
- SMTP delivery is configurable via `SMTP_URL` or `SMTP_HOST`/`SMTP_PORT` + credentials

## Relay Access Model (Domain Whitelist)

For relays such as `nostr-rs-relay`, prefer domain-based access control:

- Relay config enforces publishing from `nip05` identities at approved domains
- Noas is the identity authority (accounts + email verification + NIP-05 mapping)
- Noas does not need direct relay allowlist API integration for per-user writes
- Keep `ALLOWED_SIGNUP_EMAIL_DOMAIN` empty if all domains should register
- Use `DOMAIN_RELAY_MAP` to attach company-specific relays by email domain

Example relay config:

```toml
[verified_users]
mode = "enabled"
domain_whitelist = ["polygon.gmbh"]
```

## Development

### Testing

The project has comprehensive test coverage:

```bash
# Unit tests (auth, validation, database)
npm run test:unit

# Integration tests (API endpoints - requires server running)
npm run test:integration

# All tests
npm test

# Watch mode for TDD
npm run test:watch
```

**Unit tests** cover:
- ✅ Password hashing and verification (bcrypt)
- ✅ Input validation (usernames, keys, passwords)
- ✅ Database operations (CRUD)
- ✅ NIP-49 encrypted key validation

**Integration tests** cover:
- ✅ Complete registration flow
- ✅ Authentication and sign-in
- ✅ Invalid password rejection
- ✅ NIP-05 verification
- ✅ Duplicate username prevention
- ✅ Input validation

Integration tests use real HTTP requests to test the full API.
