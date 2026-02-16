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