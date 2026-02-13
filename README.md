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
npm test
```

Or watch mode:

```bash
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

Run tests in watch mode while developing:

```bash
npm run test:watch
```

The server uses Node.js built-in test runner (no external test framework needed).