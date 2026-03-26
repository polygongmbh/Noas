# Noas - Nostr Authentication Server

Simple username-password authentication server for Nostr with NIP-05 verification.

## Features

- Secure two-step onboarding (verify email before private key submission)
- Password-hash-based account auth (`password_hash` is SHA-256 hex)
- NIP-49 encrypted private key storage
- NIP-05 verification endpoint
- NIP-46 remote signer endpoints for active accounts
- Update password and relays
- Test coverage

## Setup

Runtime config model:
- Docker: `docker-compose.yml` is the runtime source of truth (`NOAS_LOAD_DOTENV=false`).
- Database migrations are managed with `dbmate` from `db/migrations/`.
- Local `npm run dev`: `.env` is used (`NOAS_LOAD_DOTENV=true`).

For local Postgres, include `?sslmode=disable` in `DATABASE_URL`. Managed Postgres providers may require `sslmode=require` instead.

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
DATABASE_URL=postgresql://user:password@localhost:5432/noas?sslmode=disable
DOMAIN=yourdomain.com
PORT=3000
REQUIRE_EMAIL_VERIFICATION=true
EMAIL_VERIFICATION_ENABLED=true
VERIFICATION_EXPIRY_MINUTES=15
RESEND_COOLDOWN_MINUTES=1
NIP05_DOMAIN=example.com
NOAS_PUBLIC_URL=https://noas.example.com
NOAS_BASE_PATH=/noas
ALLOWED_ORIGINS=https://nodex.example.com,https://example.com
ALLOWED_SIGNUP_EMAIL_DOMAIN=
TENANT_DEFAULT_RELAYS=
DOMAIN_RELAY_MAP=example.com=wss://tasks.example.com
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
NIP46_SIGNER_PRIVATE_KEY=
NIP46_RELAYS=
```

Primary domain settings:
- `NIP05_DOMAIN`: optional NIP-05 domain override.
  - Single domain: `example.com`
  - Multi-tenant list: `noas.progyssey.org,noas.polygon.gmbh`
  - Empty value: derive tenant domain from request host
- `NOAS_PUBLIC_URL`: public Noas URL where users access verify/UI/API. When set, this always takes precedence over request-derived URLs for `api_base` and verification links.
- `NIP46_SIGNER_PRIVATE_KEY`: optional stable signer identity for NIP-46 (`nsec` or 64-char hex)
- `NIP46_RELAYS`: comma-separated relay URLs to advertise in `bunker://` connect tokens

Most other domain-related behavior derives from these values.
Usernames are unique per tenant domain (`tenant_domain + username`), so the same username can exist on different configured domains.

### 3. Set up database

```bash
npm run db:migrate
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

**Request (auto-generate keypair):**
```json
{
  "username": "alice",
  "password": "securepassword123",
  "profile_picture_data": "<base64_image>",
  "profile_picture_content_type": "image/png",
  "redirect": "https://nodex.example.com"
}
```

**Request (client-provided keypair):**
```json
{
  "username": "alice",
  "password_hash": "sha256_hex_of_password",
  "public_key": "64-char hex pubkey",
  "private_key_encrypted": "ncryptsec1...",
  "profile_picture_data": "<base64_image>",
  "profile_picture_content_type": "image/png",
  "redirect": "https://nodex.example.com"
}
```

**Response:**
```json
{
  "success": true,
  "status": "unverified_email",
  "nip05": "alice@example.com",
  "message": "Check alice@example.com to verify your account."
}
```

If SMTP is configured, Noas sends a verification link to `username@<tenant-domain>`, where tenant domain is resolved from `NIP05_DOMAIN` (single/multi) or the request host when `NIP05_DOMAIN` is empty.  
If SMTP is not configured, verification-only dev mode works with `EXPOSE_VERIFICATION_TOKEN_IN_RESPONSE=true`.  
Set `REQUIRE_EMAIL_DELIVERY=true` to fail onboarding when mail cannot be delivered.

Primary auth endpoints (v1.4):

- `POST /api/v1/auth/register` -> creates unverified account and sends verification email.
- `GET /api/v1/auth/verify?token=...` -> previews verification link state.
- `POST /api/v1/auth/verify` -> verifies token + password hash and activates account.
- `POST /api/v1/auth/resend` -> resends verification email; clients should apply cooldown locally.

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

Resend verification email for a pending account. UI clients should respect the advertised resend cooldown locally.

```json
{
  "username": "alice"
}
```

### GET /api/v1/picture/:pubkey
### GET /api/v1/picture/:name

Fetch the current profile picture by either:
- the account's current public key (`hex` or `npub`)
- the account username

Profile picture writes are accepted on:
- `POST /api/v1/auth/register` with `profile_picture_data` + `profile_picture_content_type`
- `POST /api/v1/auth/update` with `updates.profile_picture_data` + `updates.profile_picture_content_type`

Cache behavior:
- Returns `Last-Modified` based on the stored picture update time.
- Honors `If-Modified-Since` and returns `304 Not Modified` when appropriate.

### POST /register

Deprecated legacy endpoint. Returns `410 Gone`. Use `POST /api/v1/auth/register`.

### POST /signin

Sign in and retrieve encrypted private key (active accounts only).

**Request:**
```json
{
  "username": "alice",
  "password_hash": "sha256_hex_of_password"
}
```

**Response:**
```json
{
  "success": true,
  "private_key_encrypted": "ncryptsec1...",
  "public_key": "a0b1c2d3...",
  "relays": ["wss://relay.example.com"]
}
```

### POST /api/v1/auth/update

Update password hash, public key, encrypted private key, or relays (requires authentication).

**Request:**
```json
{
  "username": "alice",
  "password": "currentpassword",
  "updates": {
    "new_password_hash": "sha256_hex_of_new_password",
    "public_key": "64-char hex pubkey",
    "private_key_encrypted": "ncryptsec1...",
    "relays": ["wss://new-relay.com"],
    "profile_picture_data": "<base64_image>",
    "profile_picture_content_type": "image/png"
  }
}
```

Credential rotation requires `new_password_hash`/`new_password`, `public_key`, and `private_key_encrypted` together.

### NIP-46 Endpoints

- `GET /api/v1/nip46/info` -> returns signer metadata and supported methods.
- `GET /api/v1/nip46/connect/:username` -> returns a `bunker://` URL for an active account.
- `POST /api/v1/nip46/nostrconnect` -> accepts a `nostrconnect://` URL and creates a signer session for an active account.
- `POST /api/v1/nip46/request` -> accepts encrypted kind `24133` requests and returns an encrypted response event.

Remote signing detail:
- `get_public_key` returns the connected account's pubkey.
- `sign_event` signs only for accounts that still have a stored raw signup password and whose NIP-49 ciphertext can be unlocked with it.
- Accounts created with client-provided `password_hash` and encrypted key material do not get server-side NIP-46 signing, because Noas never receives their raw password.
- Password/key rotation does not enable NIP-46 signing unless the account already has a stored raw signup password.

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

When called without `name`, returns Noas instance metadata (version, public URL, API base, and NIP-05 domain) for client discovery. If `NOAS_PUBLIC_URL` is configured, it takes precedence for `api_base`; otherwise the URL is derived from request headers.

## Security Notes

- Passwords are stored as client-submitted SHA-256 hashes for account authentication
- If a raw password is sent during signup, Noas also stores it in plain text for NIP-46 signing eligibility
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
domain_whitelist = ["example.com"]
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
