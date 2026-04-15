# Noas - Nostr Authentication Server

Simple username-password authentication server for Nostr with NIP-05 verification.

## Features

- Secure two-step onboarding (verify email before private key submission)
- Password-hash-based account auth (`password_hash` is SHA-256 hex)
- NIP-49 encrypted private key storage
- NIP-05 verification endpoint
- Minimal health endpoint (`/health`, `/api/v1/health`) that returns status only
- NIP-46 remote signer endpoints for active accounts
- Update password and relays
- Test coverage

## Setup

Runtime config model:
- Docker: `.env` is the runtime source of truth (loaded via `env_file` in `docker-compose.yml`).
- Database migrations are managed with `dbmate` from `db/migrations/`.
- Local `npm run dev`: `.env` is loaded by the app.

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
EMAIL_VERIFICATION_MODE=required_nip05_domains
VERIFICATION_EXPIRY_MINUTES=15
RESEND_COOLDOWN_MINUTES=1
NIP05_DOMAIN=example.com
NOAS_PUBLIC_URL=https://noas.example.com
NOAS_PUBLIC_URL_MAP=example.com=https://noas.example.com;example.org=https://noas.example.org
NOAS_BASE_PATH=/noas
ALLOWED_ORIGINS=https://nodex.example.com,https://example.com
TENANT_DEFAULT_RELAYS=
DOMAIN_RELAY_MAP=example.com=wss://tasks.example.com
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
NIP86_RELAY_URLS=
NIP86_METHOD=allowpubkey
NIP86_TIMEOUT_MS=5000
DISALLOWED_USERNAMES=feed,nostr,rnostr,base,tasks,relay
NOAS_ADMIN_USERS=admin_username
NOAS_MODERATOR_USERS=moderator_username
```

Primary domain settings:
- `NIP05_DOMAIN`: optional NIP-05 domain override.
  - Single domain: `example.com`
  - Multi-tenant list: `example.org,example.gmbh` (subdomains like `noas.example.gmbh` map to `example.gmbh`)
  - Empty value: derive tenant domain from request host
- `NOAS_PUBLIC_URL`: public Noas URL where users access verify/UI/API. Used when a tenant is not matched in `NOAS_PUBLIC_URL_MAP`. Leave empty to derive per request host for multi-tenant setups.
- `NOAS_PUBLIC_URL_MAP`: per-tenant public URL override mapping (`domain=https://noas.domain`). When a tenant domain matches, it overrides `NOAS_PUBLIC_URL` and request-derived URLs for `api_base` and verification links. Use semicolons to separate entries.
- `NIP46_SIGNER_PRIVATE_KEY`: optional stable signer identity for NIP-46 (`nsec` or 64-char hex)
- `NIP46_RELAYS`: comma-separated relay URLs to advertise in `bunker://` connect tokens
- `NIP86_RELAY_URLS`: comma-separated HTTP(S) relay admin endpoints that receive JSON-RPC `allowpubkey` after verification
- `NIP86_METHOD`: JSON-RPC method name for relay allow calls (default: `allowpubkey`)
- `NIP86_TIMEOUT_MS`: timeout per relay allow request (default: `5000`)
- `DISALLOWED_USERNAMES`: comma-separated usernames that cannot be registered.
- `NOAS_ADMIN_USERS`: comma-separated usernames granted the `admin` role at registration time.
- `NOAS_MODERATOR_USERS`: comma-separated usernames granted the `moderator` role at registration time (ignored if also in admin list).

Most other domain-related behavior derives from these values.
Usernames are unique per tenant domain (`tenant_domain + username`), so the same username can exist on different configured domains.

Email verification modes (`EMAIL_VERIFICATION_MODE`):
- `off`: account is active immediately after register; no email verification step.
- `required`: email verification is required; client must provide `email`.
- `required_nip05_domains`: email verification is required and locked to `username@<tenant_nip05_domain>`.
- Default: `required_nip05_domains` when mode and legacy flags are not set.

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
  "email": "alice@example.com",
  "password": "securepassword123",
  "relays": ["wss://relay.example.com"],
  "profile_picture_data": "<base64_image>",
  "profile_picture_content_type": "image/png",
  "redirect": "https://example.com"
}
```

**Request (client-provided keypair):**
```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password_hash": "sha256_hex_of_password",
  "public_key": "64-char hex pubkey",
  "private_key_encrypted": "ncryptsec1...",
  "relays": ["wss://relay.example.com"],
  "profile_picture_data": "<base64_image>",
  "profile_picture_content_type": "image/png",
  "redirect": "https://example.com"
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

`status` is mode-dependent:
- `off` -> `active`
- `required` / `required_nip05_domains` -> `unverified_email`

If SMTP is configured, Noas sends a verification link to the resolved registration email.  
With `EMAIL_VERIFICATION_MODE=required_nip05_domains`, this is always `username@<tenant-domain>` (tenant domain resolved from `NIP05_DOMAIN` or the request host when `NIP05_DOMAIN` is empty).  
In test mode (`NODE_ENV=test`), responses include verification tokens for automated test flows.

Primary auth endpoints (v1.4):

- `POST /api/v1/auth/register` -> creates unverified account and sends verification email.
- `GET /api/v1/auth/verify?token=...` -> previews verification link state.
- `POST /api/v1/auth/verify` -> verifies token + password hash and activates account.
- `POST /api/v1/auth/resend` -> resends verification email; clients should apply cooldown locally.

`GET /api/v1/auth/verify?token=...` response includes the resolved email used for verification when available:
```json
{
  "success": true,
  "username": "alice",
  "nip05": "alice@example.com",
  "registration_email": "alice@work.example",
  "public_key": "hex_public_key",
  "expires_at": "2024-01-01T00:00:00.000Z"
}
```

`registration_email` is null when the account was created without an email or before the migration.

Verification UI behavior:
- `GET /verify?token=...` shows password confirmation for pending accounts.
- If a verification link was already used, the page shows `Back to app` (when `redirect` is present) and `Back to Noas` (tenant landing page).
- The public UI pages are:
  - `/` (landing), `/register`, `/login`, `/docs` (endpoints + example payloads).
  - Admin and moderator users see an additional admin console in `/login` for user list and verification.
  - Role changes are admin-only. If an admin downgrades their own role, admin-only controls are removed immediately.

### POST /api/v1/auth/verify

Activate account by confirming token + password hash.

**Request:**
```json
{
  "token": "<verification_token>",
  "password_hash": "sha256_hex_of_password"
}
```

**Response:**
```json
{
  "success": true,
  "activated": true,
  "nip05": "alice@example.com",
  "relay_allow": {
    "attempted": true,
    "relays_total": 2,
    "relays_success": 2,
    "relays_failed": 0
  }
}
```

`relay_allow.attempted` is `false` when `NIP86_RELAY_URLS` is not configured.

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
  "relays": ["wss://relay.example.com"],
  "status": "active",
  "role": "user"
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

### POST /api/v1/admin/users/list

List users for admin/moderator accounts.

```json
{
  "username": "admin",
  "password_hash": "sha256_hex_of_password",
  "limit": 200
}
```

### POST /api/v1/admin/users/verify

Verify a pending account (admin/moderator).

```json
{
  "username": "admin",
  "password_hash": "sha256_hex_of_password",
  "target_username": "alice"
}
```

### POST /api/v1/admin/users/role

Update a user role (admin only). Admins can downgrade their own role, and that downgrade applies immediately.

```json
{
  "username": "admin",
  "password_hash": "sha256_hex_of_password",
  "target_username": "alice",
  "new_role": "moderator"
}
```

### POST /api/v1/admin/users/delete

Delete a user (admin/moderator).

```json
{
  "username": "admin",
  "password_hash": "sha256_hex_of_password",
  "target_username": "alice",
  "confirm_username": "alice"
}
```

`confirm_username` must exactly match `target_username`.

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

When called without `name`, returns Noas instance metadata (version, public URL, API base, NIP-05 domain, and `email_verification_mode`) for client discovery. If `NOAS_PUBLIC_URL_MAP` has a matching tenant entry, it takes precedence for `api_base`; otherwise `NOAS_PUBLIC_URL` is used, and if neither are set the URL is derived from request headers.

## Security Notes

- Passwords are stored as client-submitted SHA-256 hashes for account authentication
- If a raw password is sent during signup, Noas also stores it in plain text for NIP-46 signing eligibility
- Private keys are stored encrypted (NIP-49 format)
- Private key is only accepted after successful email verification
- Uses HTTPS in production
- Username validation: 3-32 chars, lowercase alphanumeric + underscore
- Username can be independent from email local-part (must still be unique and valid format)
- Email verification mode is controlled by `EMAIL_VERIFICATION_MODE` (`off`, `required`, `required_nip05_domains`)
- When email verification is enabled, NIP-05 lookups only expose verified users
- SMTP delivery is configurable via `SMTP_URL` or `SMTP_HOST`/`SMTP_PORT` + credentials

## Relay Access Model (NIP-86 Allowpubkey)

Noas can push relay allowlist updates through NIP-86 JSON-RPC after account verification:

- On successful `POST /api/v1/auth/verify`, Noas activates the account first.
- If `NIP86_RELAY_URLS` is configured, Noas sends one JSON-RPC request per configured relay URL.
- Default request method is `allowpubkey`, with params `[<hex_pubkey>]`.
- Verification still succeeds even if one or more relay calls fail; Noas logs failures and returns `relay_allow` summary in the verify response.

Example request body sent by Noas:

```json
{
  "jsonrpc": "2.0",
  "id": "uuid",
  "method": "allowpubkey",
  "params": ["hex_pubkey"]
}
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
