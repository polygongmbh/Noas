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
process.env.NOAS_LOAD_DOTENV = 'false';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.NIP05_DOMAIN = 'alpha.test,beta.test';
process.env.NOAS_PUBLIC_URL = '';
process.env.NOAS_PUBLIC_URL_MAP = 'alpha.test=https://noas.alpha.test;beta.test=https://noas.beta.test';

let app;
let query;
let closePool;

const baseURL = 'http://localhost:3001';
let server;
let serverReady = false;
let apitestUserPubkey = '';
const APITEST_PASSWORD = 'testpassword123';
const MULTITENANT_USER_ALPHA = `multitenant_${Date.now()}_a`;
const MULTITENANT_USER_BETA = `multitenant_${Date.now()}_b`;

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

async function requestWithHeaders(method, path, body, headers = {}) {
  try {
    const response = await fetch(`${baseURL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (error) {
    throw new Error(`Request failed: ${error.message}`);
  }
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function registerAndVerify(username, password, headers = {}) {
  const register = await requestWithHeaders(
    'POST',
    '/api/v1/auth/register',
    { username, password },
    headers
  );
  assert.strictEqual(register.status, 200);
  assert.strictEqual(register.data.success, true);
  assert.ok(register.data.verification_token);

  const verify = await requestWithHeaders(
    'POST',
    '/api/v1/auth/verify',
    {
      token: register.data.verification_token,
      password_hash: sha256Hex(password),
    },
    headers
  );
  assert.strictEqual(verify.status, 200);
  assert.strictEqual(verify.data.success, true);

  return register.data;
}

// Setup: Start test server and clean up existing test data
before(async () => {
  ({ query, closePool } = await import('./db/pool.js'));
  ({ app } = await import('./index.js'));
  // Clean up test data first
  try {
    await query(
      'DELETE FROM profile_pictures WHERE account_id IN (SELECT id FROM nostr_users WHERE username IN ($1, $2, $3, $4))',
      ['apitestuser', 'rotatinguser', MULTITENANT_USER_ALPHA, MULTITENANT_USER_BETA]
    );
    await query(
      'DELETE FROM nostr_users WHERE username IN ($1, $2, $3, $4)',
      ['apitestuser', 'rotatinguser', MULTITENANT_USER_ALPHA, MULTITENANT_USER_BETA]
    );
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

  const register = await registerAndVerify('apitestuser', APITEST_PASSWORD);
  apitestUserPubkey = register.public_key;
});

// Teardown: Clean up test data, close database, and stop server
after(async () => {
  // Clean up test data
  try {
    await query(
      'DELETE FROM profile_pictures WHERE account_id IN (SELECT id FROM nostr_users WHERE username IN ($1, $2, $3, $4))',
      ['apitestuser', 'rotatinguser', MULTITENANT_USER_ALPHA, MULTITENANT_USER_BETA]
    );
    await query(
      'DELETE FROM nostr_users WHERE username IN ($1, $2, $3, $4)',
      ['apitestuser', 'rotatinguser', MULTITENANT_USER_ALPHA, MULTITENANT_USER_BETA]
    );
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

// Auth: sign-in returns encrypted key material for an active account.
test('POST /api/v1/auth/signin returns encrypted key for valid credentials', async () => {
  const { status, data } = await request('POST', '/api/v1/auth/signin', {
    username: 'apitestuser',
    password_hash: sha256Hex(APITEST_PASSWORD),
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(data.success, true);
  assert.ok(data.private_key_encrypted.startsWith('ncryptsec'));
  assert.strictEqual(data.public_key, apitestUserPubkey);
  assert.ok(Array.isArray(data.relays));
});

// Auth: sign-in rejects incorrect credentials.
test('POST /api/v1/auth/signin rejects invalid password', async () => {
  const { status, data } = await request('POST', '/api/v1/auth/signin', {
    username: 'apitestuser',
    password_hash: sha256Hex('wrongpassword'),
  });

  assert.strictEqual(status, 401);
  assert.ok(data.error);
});

// Auth: sign-in rejects unknown usernames.
test('POST /api/v1/auth/signin rejects non-existent user', async () => {
  const { status, data } = await request('POST', '/api/v1/auth/signin', {
    username: 'nonexistent',
    password_hash: sha256Hex(APITEST_PASSWORD),
  });

  assert.strictEqual(status, 401);
  assert.ok(data.error);
});

// Auth: update rotates password hash + key material in a single request.
test('POST /update rotates password hash and encrypted key together', async () => {
  const register = await request('POST', '/api/v1/auth/register', {
    username: 'rotatinguser',
    password: 'rotatepassword123',
  });

  assert.strictEqual(register.status, 200);
  assert.ok(register.data.public_key);
  assert.ok(register.data.verification_token);

  const verify = await request('POST', '/api/v1/auth/verify', {
    token: register.data.verification_token,
    password_hash: sha256Hex('rotatepassword123'),
  });
  assert.strictEqual(verify.status, 200);
  assert.strictEqual(verify.data.success, true);

  const initialSignin = await request('POST', '/api/v1/auth/signin', {
    username: 'rotatinguser',
    password_hash: sha256Hex('rotatepassword123'),
  });

  assert.strictEqual(initialSignin.status, 200);
  assert.ok(initialSignin.data.private_key_encrypted);
  assert.ok(initialSignin.data.public_key);

  const initialPasswordHash = sha256Hex('rotatepassword123');
  const rotatedPasswordHash = sha256Hex('rotatepassword456');
  const secretKey = decrypt(initialSignin.data.private_key_encrypted, 'rotatepassword123');
  const rotatedPrivateKeyEncrypted = encrypt(secretKey, 'rotatepassword456');
  const rotatedPublicKey = getPublicKey(secretKey).toLowerCase();

  const update = await request('POST', '/api/v1/auth/update', {
    username: 'rotatinguser',
    password_hash: initialPasswordHash,
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

// NIP-05: lookup returns the stored pubkey for a verified user.
test('GET /.well-known/nostr.json returns user public key', async () => {
  const response = await fetch(`${baseURL}/.well-known/nostr.json?name=apitestuser`);
  const data = await response.json();

  assert.strictEqual(response.status, 200);
  assert.ok(data.names);
  assert.strictEqual(data.names.apitestuser, apitestUserPubkey);
});

// NIP-05: lookup returns 404 for unknown users.
test('GET /.well-known/nostr.json returns 404 for non-existent user', async () => {
  const response = await fetch(`${baseURL}/.well-known/nostr.json?name=nonexistent`);
  const data = await response.json();

  assert.strictEqual(response.status, 404);
  assert.ok(data.error);
});

// Multi-tenant: metadata uses forwarded host for nip05_domain/public_url/api_base.
test('GET /.well-known/nostr.json metadata honors forwarded host for multi-tenant', async () => {
  const alphaMeta = await requestWithHeaders(
    'GET',
    '/.well-known/nostr.json',
    null,
    {
      'x-forwarded-host': 'noas.alpha.test',
      'x-forwarded-proto': 'https',
    }
  );
  assert.strictEqual(alphaMeta.status, 200);
  assert.strictEqual(alphaMeta.data?.noas?.nip05_domain, 'alpha.test');
  assert.strictEqual(alphaMeta.data?.noas?.public_url, 'https://noas.alpha.test');
  assert.strictEqual(alphaMeta.data?.noas?.api_base, 'https://noas.alpha.test/api/v1');

  const betaMeta = await requestWithHeaders(
    'GET',
    '/.well-known/nostr.json',
    null,
    {
      'x-forwarded-host': 'noas.beta.test',
      'x-forwarded-proto': 'https',
    }
  );
  assert.strictEqual(betaMeta.status, 200);
  assert.strictEqual(betaMeta.data?.noas?.nip05_domain, 'beta.test');
  assert.strictEqual(betaMeta.data?.noas?.public_url, 'https://noas.beta.test');
  assert.strictEqual(betaMeta.data?.noas?.api_base, 'https://noas.beta.test/api/v1');
});

test('GET /.well-known/nostr.json metadata honors NOAS_PUBLIC_URL_MAP', async () => {
  const mappedMeta = await requestWithHeaders(
    'GET',
    '/.well-known/nostr.json',
    null,
    {
      'x-forwarded-host': 'api.alpha.test',
      'x-forwarded-proto': 'https',
    }
  );
  assert.strictEqual(mappedMeta.status, 200);
  assert.strictEqual(mappedMeta.data?.noas?.nip05_domain, 'alpha.test');
  assert.strictEqual(mappedMeta.data?.noas?.public_url, 'https://noas.alpha.test');
  assert.strictEqual(mappedMeta.data?.noas?.api_base, 'https://noas.alpha.test/api/v1');
});

// Multi-tenant: registration uses the tenant derived from the request host.
test('Registration uses tenant domain from request host', async () => {
  const alphaSignup = await requestWithHeaders(
    'POST',
    '/api/v1/auth/register',
    {
      username: MULTITENANT_USER_ALPHA,
      password: 'testpassword123',
    },
    {
      'x-forwarded-host': 'noas.alpha.test',
      'x-forwarded-proto': 'https',
    }
  );
  assert.strictEqual(alphaSignup.status, 200);
  assert.ok(alphaSignup.data.nip05.endsWith('@alpha.test'));

  const betaSignup = await requestWithHeaders(
    'POST',
    '/api/v1/auth/register',
    {
      username: MULTITENANT_USER_BETA,
      password: 'testpassword123',
    },
    {
      'x-forwarded-host': 'noas.beta.test',
      'x-forwarded-proto': 'https',
    }
  );
  assert.strictEqual(betaSignup.status, 200);
  assert.ok(betaSignup.data.nip05.endsWith('@beta.test'));
});

// Health: returns service status payload.
test('GET /health returns server status', async () => {
  const response = await fetch(`${baseURL}/health`);
  const data = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(data.status, 'ok');
  assert.ok(data.domain);
});

// Profile picture: upload via /api/v1/auth/update and fetch by pubkey.
test('POST /api/v1/auth/update uploads and GET /api/v1/picture/:pubkey serves image', async () => {
  const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2S+0sAAAAASUVORK5CYII=';
  const upload = await request('POST', '/api/v1/auth/update', {
    username: 'apitestuser',
    password_hash: sha256Hex(APITEST_PASSWORD),
    updates: {
      profile_picture_content_type: 'image/png',
      profile_picture_data: imageBase64,
    },
  });

  assert.strictEqual(upload.status, 200);
  assert.strictEqual(upload.data.success, true);
  assert.ok(upload.data.picture_url.includes(`/api/v1/picture/${apitestUserPubkey}`));

  const pictureResponse = await fetch(`${baseURL}/api/v1/picture/${apitestUserPubkey}`);
  assert.strictEqual(pictureResponse.status, 200);
  assert.strictEqual(pictureResponse.headers.get('content-type'), 'image/png');

  const buffer = Buffer.from(await pictureResponse.arrayBuffer());
  assert.deepStrictEqual(buffer, Buffer.from(imageBase64, 'base64'));
});
