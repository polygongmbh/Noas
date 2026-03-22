/**
 * API Routes Integration Tests
 * 
 * Full end-to-end tests of all HTTP endpoints.
 * Tests registration, authentication, updates, and NIP-05 verification.
 * Uses a separate test server on port 3001.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { getPublicKey } from 'nostr-tools';
import { decrypt, encrypt } from 'nostr-tools/nip49';
import { app } from './index.js';
import { query, closePool } from './db/pool.js';

const baseURL = 'http://localhost:3001';
let server;
let serverReady = false;
let apitestUserPubkey = '';
const APITEST_PRIVATE_KEY = '1'.repeat(64);
const UPDATEUSER_PRIVATE_KEY = '2'.repeat(64);
const STAGED_PRIVATE_KEY = '3'.repeat(64);

/**
 * Helper function to make HTTP requests to the test server
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - URL path
 * @param {Object} body - Request body (will be JSON stringified)
 * @returns {Object} {status, data} - Response status and parsed JSON
 */
async function request(method, path, body) {
  try {
    const response = await fetch(`${baseURL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (error) {
    throw new Error(`Request failed: ${error.message}`);
  }
}

// Setup: Start test server and clean up existing test data
before(async () => {
  // Clean up test data first
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS profile_pictures (
        account_id INTEGER PRIMARY KEY,
        content_type VARCHAR(100) NOT NULL,
        data BYTEA NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS profile_picture BYTEA;
    `);
    await query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS profile_picture_type VARCHAR(100);
    `);
    await query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS profile_picture_updated_at TIMESTAMP;
    `);
    await query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email VARCHAR(320);
    `);
    await query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;
    `);
    await query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(128);
    `);
    await query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP;
    `);
    await query('DELETE FROM users WHERE username IN ($1, $2, $3, $4)', ['apitestuser', 'updateuser', 'stageduser', 'pendinguser']);
  } catch (e) {
    // Ignore if table doesn't exist yet
  }
  
  // Start test server on different port
  await new Promise((resolve, reject) => {
    server = app.listen(3001, (err) => {
      if (err) reject(err);
      else {
        serverReady = true;
        setTimeout(resolve, 300); // Give server time to be ready
      }
    });
  });
});

// Teardown: Clean up test data, close database, and stop server
after(async () => {
  // Clean up test data
  try {
    await query('DELETE FROM users WHERE username IN ($1, $2, $3, $4)', ['apitestuser', 'updateuser', 'stageduser', 'pendinguser']);
  } catch (e) {
    // Ignore cleanup errors
  }
  
  // Close server
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  
  // Close database pool
  await closePool();
});

// Test: POST /register successfully creates a new user account
test('POST /register creates a new user', async () => {
  const { status, data } = await request('POST', '/register', {
    username: 'apitestuser',
    password: 'testpassword123',
    nsecKey: APITEST_PRIVATE_KEY,
    email: 'apitestuser@polygon.gmbh',
    relays: ['wss://relay.test.com'],
  });

  assert.strictEqual(status, 201);
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.user.username, 'apitestuser');
  assert.ok(/^[a-f0-9]{64}$/.test(data.user.publicKey));
  apitestUserPubkey = data.user.publicKey;
});

test('POST /onboarding/start -> /verify-email -> /onboarding/complete creates user', async () => {
  const start = await request('POST', '/onboarding/start', {
    username: 'stageduser',
    password: 'stagepass123',
    email: 'stageduser@polygon.gmbh',
    relays: ['wss://relay.test.com'],
  });

  assert.strictEqual(start.status, 200);
  assert.strictEqual(start.data.success, true);
  assert.strictEqual(start.data.onboarding.username, 'stageduser');

  const verify = await request('POST', '/verify-email', {
    username: 'stageduser',
    token: start.data.emailVerificationToken,
    pin: start.data.emailVerificationPin,
  });
  assert.strictEqual(verify.status, 200);
  assert.strictEqual(verify.data.success, true);
  assert.strictEqual(verify.data.onboarding.emailVerified, true);

  const complete = await request('POST', '/onboarding/complete', {
    username: 'stageduser',
    password: 'stagepass123',
    nsecKey: STAGED_PRIVATE_KEY,
  });

  assert.strictEqual(complete.status, 201);
  assert.strictEqual(complete.data.success, true);
  assert.strictEqual(complete.data.user.username, 'stageduser');
});

test('POST /onboarding/complete rejects before verification', async () => {
  await request('POST', '/onboarding/start', {
    username: 'pendinguser',
    password: 'stagepass123',
    email: 'pendinguser@polygon.gmbh',
  });

  const complete = await request('POST', '/onboarding/complete', {
    username: 'pendinguser',
    password: 'stagepass123',
    nsecKey: STAGED_PRIVATE_KEY,
  });

  assert.strictEqual(complete.status, 403);
  assert.ok(complete.data.error.includes('Email must be verified'));
});

// Test: POST /register rejects duplicate usernames with 409 Conflict
test('POST /register rejects duplicate username', async () => {
  const { status, data } = await request('POST', '/register', {
    username: 'apitestuser',
    password: 'testpassword123',
    nsecKey: APITEST_PRIVATE_KEY,
    email: 'apitestuser@polygon.gmbh',
  });

  assert.strictEqual(status, 409);
  assert.ok(data.error.includes('already taken'));
});

// Test: POST /register validates username format and rejects invalid usernames
test('POST /register validates username format', async () => {
  const { status, data } = await request('POST', '/register', {
    username: 'Invalid-User',
    password: 'testpassword123',
    nsecKey: APITEST_PRIVATE_KEY,
    email: 'invalid@polygon.gmbh',
  });

  assert.strictEqual(status, 400);
  assert.ok(data.error);
});

// Test: POST /signin returns encrypted key and user data for valid credentials
test('POST /signin returns encrypted key for valid credentials', async () => {
  const { status, data } = await request('POST', '/signin', {
    username: 'apitestuser',
    password: 'testpassword123',
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(data.success, true);
  assert.ok(data.encryptedPrivateKey.startsWith('ncryptsec'));
  assert.strictEqual(data.publicKey, apitestUserPubkey);
  assert.ok(Array.isArray(data.relays));
});

// Test: POST /signin rejects incorrect password with 401 Unauthorized
test('POST /signin rejects invalid password', async () => {
  const { status, data } = await request('POST', '/signin', {
    username: 'apitestuser',
    password: 'wrongpassword',
  });

  assert.strictEqual(status, 401);
  assert.ok(data.error);
});

// Test: POST /signin rejects non-existent users with 401 Unauthorized
test('POST /signin rejects non-existent user', async () => {
  const { status, data } = await request('POST', '/signin', {
    username: 'nonexistent',
    password: 'testpassword123',
  });

  assert.strictEqual(status, 401);
  assert.ok(data.error);
});

// Test: POST /update successfully changes user password
test('POST /update changes password', async () => {
  // First register a user
  await request('POST', '/register', {
    username: 'updateuser',
    password: 'oldpassword123',
    nsecKey: UPDATEUSER_PRIVATE_KEY,
    email: 'updateuser@polygon.gmbh',
  });

  // Update password
  const { status, data } = await request('POST', '/update', {
    username: 'updateuser',
    password: 'oldpassword123',
    updates: {
      new_password: 'newpassword123',
    },
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(data.success, true);

  // Try signing in with new password
  const signin = await request('POST', '/signin', {
    username: 'updateuser',
    password: 'newpassword123',
  });

  assert.strictEqual(signin.status, 200);
});

// Test: POST /update changes password and key material together
test('POST /update rotates password hash and encrypted key together', async () => {
  const register = await request('POST', '/api/v1/auth/register', {
    username: 'rotatinguser',
    password: 'rotatepassword123',
  });

  assert.strictEqual(register.status, 200);
  assert.ok(register.data.public_key);

  const initialSignin = await request('POST', '/api/v1/auth/signin', {
    username: 'rotatinguser',
    password_hash: createHash('sha256').update('rotatepassword123').digest('hex'),
  });

  assert.strictEqual(initialSignin.status, 200);
  assert.ok(initialSignin.data.private_key_encrypted);
  assert.ok(initialSignin.data.public_key);

  const secretKey = decrypt(initialSignin.data.private_key_encrypted, 'rotatepassword123');
  const rotatedPrivateKeyEncrypted = encrypt(secretKey, 'rotatepassword456');
  const rotatedPublicKey = getPublicKey(secretKey).toLowerCase();
  const rotatedPasswordHash = createHash('sha256').update('rotatepassword456').digest('hex');

  const update = await request('POST', '/api/v1/auth/update', {
    username: 'rotatinguser',
    password_hash: createHash('sha256').update('rotatepassword123').digest('hex'),
    updates: {
      new_password_hash: rotatedPasswordHash,
      public_key: rotatedPublicKey,
      private_key_encrypted: rotatedPrivateKeyEncrypted,
    },
  });

  assert.strictEqual(update.status, 200);
  assert.strictEqual(update.data.success, true);

  const rotatedSignin = await request('POST', '/api/v1/auth/signin', {
    username: 'rotatinguser',
    password_hash: rotatedPasswordHash,
  });

  assert.strictEqual(rotatedSignin.status, 200);
  assert.strictEqual(rotatedSignin.data.public_key, rotatedPublicKey);
  assert.strictEqual(rotatedSignin.data.private_key_encrypted, rotatedPrivateKeyEncrypted);
});

// Test: GET /.well-known/nostr.json returns public key for NIP-05 verification
test('GET /.well-known/nostr.json returns user public key', async () => {
  const response = await fetch(`${baseURL}/.well-known/nostr.json?name=apitestuser`);
  const data = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(data.names);
  assert.strictEqual(data.names.apitestuser, apitestUserPubkey);
});

// Test: GET /.well-known/nostr.json returns 404 for non-existent users
test('GET /.well-known/nostr.json returns 404 for non-existent user', async () => {
  const response = await fetch(`${baseURL}/.well-known/nostr.json?name=nonexistent`);
  const data = await response.json();

  assert.strictEqual(response.status, 404);
  assert.ok(data.error);
});

// Test: GET /health returns server status and configuration
test('GET /health returns server status', async () => {
  const response = await fetch(`${baseURL}/health`);
  const data = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(data.status, 'ok');
  assert.ok(data.domain);
});

// Test: POST /picture uploads and GET /picture/:pubkey serves the image
test('POST /picture uploads and GET /picture/:pubkey serves image', async () => {
  const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2S+0sAAAAASUVORK5CYII=';
  const upload = await request('POST', '/picture', {
    username: 'apitestuser',
    password: 'testpassword123',
    content_type: 'image/png',
    data: imageBase64,
  });

  assert.strictEqual(upload.status, 200);
  assert.strictEqual(upload.data.success, true);
  assert.ok(upload.data.url.includes(`/picture/${apitestUserPubkey}`));

  const pictureResponse = await fetch(`${baseURL}/picture/${apitestUserPubkey}`);
  assert.strictEqual(pictureResponse.status, 200);
  assert.strictEqual(pictureResponse.headers.get('content-type'), 'image/png');

  const buffer = Buffer.from(await pictureResponse.arrayBuffer());
  assert.deepStrictEqual(buffer, Buffer.from(imageBase64, 'base64'));
});
