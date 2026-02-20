/**
 * API Routes Integration Tests
 * 
 * Full end-to-end tests of all HTTP endpoints.
 * Tests registration, authentication, updates, and NIP-05 verification.
 * Uses a separate test server on port 3001.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import { app } from './index.js';
import { query, closePool } from './db/pool.js';

const baseURL = 'http://localhost:3001';
let server;
let serverReady = false;

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
    await query('DELETE FROM users WHERE username IN ($1, $2)', ['apitestuser', 'updateuser']);
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
    await query('DELETE FROM users WHERE username IN ($1, $2)', ['apitestuser', 'updateuser']);
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
    publicKey: 'b'.repeat(64),
    encryptedPrivateKey: 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p',
    relays: ['wss://relay.test.com'],
  });

  assert.strictEqual(status, 201);
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.user.username, 'apitestuser');
  assert.strictEqual(data.user.publicKey, 'b'.repeat(64));
});

// Test: POST /register rejects duplicate usernames with 409 Conflict
test('POST /register rejects duplicate username', async () => {
  const { status, data } = await request('POST', '/register', {
    username: 'apitestuser',
    password: 'testpassword123',
    publicKey: 'c'.repeat(64),
    encryptedPrivateKey: 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p',
  });

  assert.strictEqual(status, 409);
  assert.ok(data.error.includes('already taken'));
});

// Test: POST /register validates username format and rejects invalid usernames
test('POST /register validates username format', async () => {
  const { status, data } = await request('POST', '/register', {
    username: 'Invalid-User',
    password: 'testpassword123',
    publicKey: 'd'.repeat(64),
    encryptedPrivateKey: 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p',
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
  assert.strictEqual(data.publicKey, 'b'.repeat(64));
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
    publicKey: 'e'.repeat(64),
    encryptedPrivateKey: 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p',
  });

  // Update password
  const { status, data } = await request('POST', '/update', {
    username: 'updateuser',
    password: 'oldpassword123',
    updates: {
      newPassword: 'newpassword123',
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

// Test: GET /.well-known/nostr.json returns public key for NIP-05 verification
test('GET /.well-known/nostr.json returns user public key', async () => {
  const response = await fetch(`${baseURL}/.well-known/nostr.json?name=apitestuser`);
  const data = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(data.names);
  assert.strictEqual(data.names.apitestuser, 'b'.repeat(64));
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
    contentType: 'image/png',
    data: imageBase64,
  });

  assert.strictEqual(upload.status, 200);
  assert.strictEqual(upload.data.success, true);
  assert.ok(upload.data.url.includes(`/picture/${'b'.repeat(64)}`));

  const pictureResponse = await fetch(`${baseURL}/picture/${'b'.repeat(64)}`);
  assert.strictEqual(pictureResponse.status, 200);
  assert.strictEqual(pictureResponse.headers.get('content-type'), 'image/png');

  const buffer = Buffer.from(await pictureResponse.arrayBuffer());
  assert.deepStrictEqual(buffer, Buffer.from(imageBase64, 'base64'));
});
