# Noas - Nostr Authentication Server

Simple username-password authentication server for Nostr with NIP-05 verification.

## Features

- Secure two-step onboarding (verify email before private key submission)
- Password-hash-based account auth (`password_hash` is SHA-256 hex)
- NIP-49 encrypted private key storage
- NIP-05 verification endpoint
- Minimal health endpoint (`/api/v1/health`) that returns status only
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
NIP86_RELAY_URLS=
DOMAIN_NIP86_RELAY_MAP=
DISALLOWED_USERNAMES=feed,nostr,rnostr,base,tasks,relay,noas,go,nodex,caldav,calendar,dav
NOAS_ADMIN_USERS=admin_username,64_char_hex_pubkey
SERVICE_API_KEYS=
CUSTODY_MASTER_KEY=
```

Primary domain settings:
- `NIP05_DOMAIN`: optional NIP-05 domain override.
  - Single domain: `example.com`
  - Multi-tenant list: `example.org,example.gmbh` (subdomains like `noas.example.gmbh` map to `example.gmbh`)
  - Empty value: derive tenant domain from request host
- `NOAS_PUBLIC_URL`: public Noas URL where users access verify/UI/API. Used when a tenant is not matched in `NOAS_PUBLIC_URL_MAP`. Leave empty to derive per request host for multi-tenant setups.
- `NOAS_PUBLIC_URL_MAP`: per-tenant public URL override mapping (`domain=https://noas.domain`). When a tenant domain matches, it overrides `NOAS_PUBLIC_URL` and request-derived URLs for `api_base` and verification links. Use semicolons to separate entries.
- `NIP46_SIGNER_PRIVATE_KEY`: optional stable signer identity for NIP-46 (`nsec` or 64-char hex)
- `NIP86_RELAY_URLS`: comma-separated HTTP(S) relay admin endpoints that receive JSON-RPC `allowpubkey` after verification
- `DOMAIN_NIP86_RELAY_MAP`: optional per-domain HTTP(S) relay admin endpoint mapping (`domain=https://relay-admin.domain`), semicolon separated
- `DISALLOWED_USERNAMES`: comma-separated usernames that cannot be registered.
- `NOAS_ADMIN_USERS`: comma-separated initial admin identifiers applied at registration time. Each entry may be a username or a 64-character hex public key.
- `SERVICE_API_KEYS`: comma-separated shared secrets for trusted services calling `/api/v1/service/*` (via the `X-Noas-Service-Key` header). Empty disables the service API.
- `CUSTODY_MASTER_KEY`: NIP-49 password used to encrypt the keys of service-provisioned accounts (`custody = master_key`). Generate a strong random secret (e.g. `openssl rand -hex 32`) and never rotate it casually — existing custodial ciphertexts are bound to it.

Implementation note:
- Relay allow provisioning internals (JSON-RPC method, timeout, worker interval, retry/backoff) are intentionally fixed in code to keep operator configuration surface minimal and safer by default.
- Background worker internals for retention/quota/reconcile intervals are also fixed in code; retention is active, while quota/reconcile currently run as framework no-op passes for future enforcement/reconciliation logic.

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
    "mode": "queued",
    "relays_total": 2,
    "relays_enqueued": 2,
    "relays_not_enqueued": 0
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

### POST /api/v1/auth/signin

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

### POST /api/v1/relays

Create (append) a relay URL for an authenticated account. This is additive and idempotent for duplicate relay URLs.

**Request:**
```json
{
  "username": "alice",
  "password_hash": "sha256_hex_of_password",
  "relay_url": "wss://relay.example.com",
  "policy": {
    "read": true,
    "write": true
  }
}
```

Notes:
- `username` is normalized to lowercase before validation.
- Reserved usernames are rejected using the same validation rules as registration.
- `relay_url` must be a valid `wss://` URL.
- If tenant relay mapping is configured (`DOMAIN_RELAY_MAP`), manual relay creation is rejected for that tenant.
- Relay insertion is transaction-backed and duplicate URLs do not create duplicate entries.
- Successful inserts enqueue an async relay allow job (non-blocking response path).

**Response (inserted):**
```json
{
  "success": true,
  "relay": {
    "url": "wss://relay.example.com",
    "policy": {
      "read": true,
      "write": true
    }
  },
  "inserted": true,
  "default_policy": {
    "read": true,
    "write": true
  },
  "job": {
    "enqueued": true,
    "id": "..."
  },
  "relays": ["wss://relay.example.com"]
}
```

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
- `sign_event` signs only for accounts whose NIP-49 decryption secret Noas holds: a stored raw signup password (`custody = password`, legacy) or the `CUSTODY_MASTER_KEY` for service-provisioned accounts (`custody = master_key`).
- Accounts created with client-provided `password_hash` and encrypted key material do not get server-side NIP-46 signing, because Noas never receives their raw password.
- Password/key rotation does not enable NIP-46 signing unless the account already has a stored raw signup password.

### Service API (trusted services)

Internal endpoints for trusted services (e.g. the nail mailing-list engine)
that manage custodial subscriber identities. All `/api/v1/service/*` routes
require the `X-Noas-Service-Key` header with one of the comma-separated
secrets from `SERVICE_API_KEYS`; when no keys are configured the service API
responds `503`.

#### POST /api/v1/service/accounts

Provision (or return) the custodial account for a subscriber email.
Requires `CUSTODY_MASTER_KEY`. The username is derived from the email local
part (lowercased, stripped to `a-z0-9-_.`, numeric suffix on collision), the
generated key is NIP-49 encrypted with the master key (`custody =
master_key`, no stored raw password), and the account is created `active` —
email ownership verification (double opt-in) is the calling service's
responsibility. Idempotent per `(tenant_domain, email)`; publishes no nostr
events.

**Request:**
```json
{
  "email": "jane.doe@example.com",
  "tenant_domain": "example.com"
}
```

**Response (`201` on create, `200` on repeat):**
```json
{
  "success": true,
  "username": "jane.doe",
  "pubkey": "a0b1c2d3...",
  "created": true
}
```

#### DELETE /api/v1/service/accounts

Delete the custodial account for a subscriber (best-effort account wipe on
behalf of the calling service). Identify the account with `email` or
`username` plus `tenant_domain`, in the JSON body or the query string.
Only `custody = master_key` accounts can be deleted this way (`403`
otherwise; email lookup only matches custodial accounts). Sessions and
magic link tokens are revoked with the account, and relay unallow jobs are
enqueued for its pubkey — like the user/admin delete paths.

**Request:** `{"email": "jane.doe@example.com", "tenant_domain": "example.com"}`

**Response:**
```json
{
  "success": true,
  "deleted": {
    "username": "jane.doe",
    "pubkey": "a0b1c2d3..."
  }
}
```

#### POST /api/v1/service/magic-links

Issue a single-use magic link token for a subscriber email. `purpose` is
`login` (30-minute expiry) or `confirm` (7-day expiry). Noas does not send
any email for these — the calling service renders and delivers the link.
`404` when no account is registered for the email.

**Request:**
```json
{
  "email": "jane.doe@example.com",
  "tenant_domain": "example.com",
  "purpose": "login"
}
```

**Response:**
```json
{
  "success": true,
  "token": "3f2a...",
  "purpose": "login",
  "expires_at": "2026-07-12T12:30:00.000Z"
}
```

#### POST /api/v1/service/sign

Sign an unsigned nostr event template with a custodial account's key.
Only `custody = master_key` accounts are eligible (`403` otherwise). In
place of the service key, a subscriber bearer session token
(`Authorization: Bearer <session_token>`) is accepted — then `username`
must match the session account. `event.content` defaults to `""`,
`event.tags` to `[]`, and `event.created_at` to the current time; `pubkey`,
`id`, and `sig` are always derived server-side.

**Request:**
```json
{
  "username": "jane.doe",
  "tenant_domain": "example.com",
  "event": {
    "kind": 1,
    "content": "hello nostr",
    "tags": [["t", "nail"]],
    "created_at": 1783800000
  }
}
```

**Response:**
```json
{
  "success": true,
  "event": {
    "kind": 1,
    "content": "hello nostr",
    "tags": [["t", "nail"]],
    "created_at": 1783800000,
    "pubkey": "a0b1c2d3...",
    "id": "e4f5...",
    "sig": "90ab..."
  }
}
```

### Magic Link Sessions

Public endpoints for subscribers holding a magic link.

#### POST /api/v1/auth/magic/verify

Exchange a single-use magic link token for an opaque bearer session token
with a 30-day sliding expiry. `404` for unknown tokens, `410` for used or
expired ones.

**Request:** `{"token": "3f2a..."}`

**Response:**
```json
{
  "success": true,
  "session_token": "9c1b...",
  "username": "jane.doe",
  "pubkey": "a0b1c2d3...",
  "purpose": "login",
  "expires_at": "2026-08-11T12:00:00.000Z"
}
```

#### GET /api/v1/auth/session

With `Authorization: Bearer <session_token>`: returns account info and
slides the session expiry forward to 30 days from now. `401` for missing,
unknown, or expired tokens.

**Response:**
```json
{
  "success": true,
  "username": "jane.doe",
  "pubkey": "a0b1c2d3...",
  "tenant_domain": "example.com",
  "registration_email": "jane.doe@example.com",
  "expires_at": "2026-08-11T12:00:00.000Z"
}
```

#### DELETE /api/v1/auth/session

With `Authorization: Bearer <session_token>`: revokes the session (logout).
Returns `{"success": true}`.

### GET /.well-known/nostr.json?name=alice

NIP-05 verification endpoint.

**Response:**
```json
{
  "names": {
    "alice": "a0b1c2d3..."
  },
  "relays": {
    "a0b1c2d3...": ["wss://relay.example.com"]
  }
}
```

When called without `name`, returns Noas instance metadata for client discovery:

```json
{
  "noas": {
    "version": "1.2.3",
    "nip05_domain": "example.com",
    "public_url": "https://noas.example.com",
    "base_path": "/",
    "api_base": "https://noas.example.com/api/v1",
    "email_verification_mode": "required_nip05_domains",
    "relays": ["wss://tasks.example.com"]
  }
}
```

`relays` is the tenant's default space list — its `DOMAIN_RELAY_MAP` entry if the tenant root domain is mapped, otherwise `TENANT_DEFAULT_RELAYS` (protected domain-mapped relays filtered out), or `[]` when nothing is configured. It lets clients adopt a default space without any per-account configuration. If `NOAS_PUBLIC_URL_MAP` has a matching tenant entry, it takes precedence for `api_base`; otherwise `NOAS_PUBLIC_URL` is used, and if neither are set the URL is derived from request headers.

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

Noas can queue durable relay allowlist updates through NIP-86 JSON-RPC after account verification:

- On successful `POST /api/v1/auth/verify`, Noas activates the account first.
- If `DOMAIN_NIP86_RELAY_MAP` contains the tenant domain, those endpoints are used. Otherwise `NIP86_RELAY_URLS` is used.
- Jobs are persisted in PostgreSQL, processed by the relay-allow worker, and retried with exponential backoff.
- Default request method is `allowpubkey`, with params `[<hex_pubkey>]`.
- Verification still succeeds even if calls fail later; Noas returns queue summary in the verify response.

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
- ✅ Key custody modes and master-key signing
- ✅ Service account provisioning, magic link tokens, sessions

**Integration tests** cover:
- ✅ Complete registration flow
- ✅ Authentication and sign-in
- ✅ Invalid password rejection
- ✅ NIP-05 verification
- ✅ Duplicate username prevention
- ✅ Input validation
- ✅ Service API (accounts, magic links, sessions, signing) — set
  `NOAS_TEST_SERVICE_KEY` to one of the server's `SERVICE_API_KEYS`
  (server must also have `CUSTODY_MASTER_KEY` configured), otherwise
  these tests are skipped

Integration tests use real HTTP requests to test the full API.
