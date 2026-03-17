# Noas - Nostr Authentication Server

Simple username-password authentication server for Nostr with NIP-05 verification.

## Features

- Username/password registration
- Secure password hashing (bcrypt)
- NIP-49 encrypted private key storage
- NIP-05 verification endpoint
- Update password and relays
- Test coverage

## Setup

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
ALLOWED_SIGNUP_EMAIL_DOMAIN=
TENANT_DEFAULT_RELAYS=
DOMAIN_RELAY_MAP=polygon.gmbh=wss://tasks.polygon.gmbh
```

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

### POST /register

Register a new user.

**Request:**
```json
{
  "username": "alice",
  "email": "alice@polygon.gmbh",
  "password": "securepassword123",
  "publicKey": "a0b1c2d3...",
  "encryptedPrivateKey": "ncryptsec1...",
  "relays": ["wss://relay.example.com"]
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "username": "alice",
    "publicKey": "a0b1c2d3..."
  }
}
```

### POST /signin

Sign in and retrieve encrypted private key.

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

Update password or relays (requires authentication).

**Request:**
```json
{
  "username": "alice",
  "password": "currentpassword",
  "updates": {
    "newPassword": "newpassword123",
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

## Security Notes

- Passwords are hashed with bcrypt (never stored plain)
- Private keys are stored encrypted (NIP-49 format)
- Client encrypts private key with user's password before sending
- Uses HTTPS in production
- Username validation: 3-32 chars, lowercase alphanumeric + underscore
- Optional email verification gate before sign-in (`REQUIRE_EMAIL_VERIFICATION=true`)
- When email verification is enabled, NIP-05 lookups only expose verified users

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
