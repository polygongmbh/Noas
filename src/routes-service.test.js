/**
 * Service API Routes Integration Tests
 *
 * End-to-end tests of the service endpoints used by trusted services
 * (e.g. nail): service-key auth and custodial account provisioning.
 * Uses a separate test server on port 3004.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import { getPublicKey } from 'nostr-tools';
import { decrypt } from 'nostr-tools/nip49';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const TEST_SERVICE_KEY = 'routes-service-test-key';
const TEST_MASTER_KEY = 'routes-service-test-master-key';
process.env.SERVICE_API_KEYS = `${TEST_SERVICE_KEY},secondary-service-key`;
process.env.CUSTODY_MASTER_KEY = TEST_MASTER_KEY;

const TEST_TENANT = 'routes-service.test';
const baseURL = 'http://localhost:3004';

let app;
let pool;
let server;

/**
 * Helper to make HTTP requests to the test server
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {Object|null} body - Request body (JSON stringified)
 * @param {Object} headers - Extra request headers
 * @returns {Object} {status, data}
 */
async function request(method, path, body, headers = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function serviceHeaders(extra = {}) {
  return { 'X-Noas-Service-Key': TEST_SERVICE_KEY, ...extra };
}

let dbAvailable = true;
try {
  ({ pool } = await import('./db/pool.js'));
  await pool.query('SELECT 1');
} catch (error) {
  dbAvailable = false;
  console.warn('[routes-service.test] Skipping DB tests: database unavailable:', error.code || error.message);
}

describe('Service API Routes', { skip: !dbAvailable }, () => {

before(async () => {
  ({ app } = await import('./index.js'));
  await pool.query('DELETE FROM nostr_users WHERE tenant_domain = $1', [TEST_TENANT]);
  await new Promise((resolve, reject) => {
    server = app.listen(3004, (err) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  await pool.query('DELETE FROM nostr_users WHERE tenant_domain = $1', [TEST_TENANT]);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

// Service auth: requests without the shared secret are rejected.
test('service routes reject requests without a service key', async () => {
  const { status, data } = await request('POST', '/api/v1/service/accounts', {
    email: 'gate@example.com',
    tenant_domain: TEST_TENANT,
  });

  assert.strictEqual(status, 401);
  assert.ok(data.error);
});

// Service auth: a wrong key is rejected.
test('service routes reject requests with an invalid service key', async () => {
  const { status, data } = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'gate@example.com', tenant_domain: TEST_TENANT },
    { 'X-Noas-Service-Key': 'not-the-key' }
  );

  assert.strictEqual(status, 401);
  assert.ok(data.error);
});

// Accounts: provisioning creates an active custodial account.
test('POST /api/v1/service/accounts provisions a custodial account', async () => {
  const { status, data } = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'Jane.Doe@Example.com', tenant_domain: TEST_TENANT },
    serviceHeaders()
  );

  assert.strictEqual(status, 201);
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.created, true);
  assert.strictEqual(data.username, 'jane.doe');
  assert.match(data.pubkey, /^[a-f0-9]{64}$/);

  const stored = await pool.query(
    'SELECT * FROM nostr_users WHERE tenant_domain = $1 AND username = $2',
    [TEST_TENANT, data.username]
  );
  const user = stored.rows[0];
  assert.ok(user);
  assert.strictEqual(user.status, 'active');
  assert.strictEqual(user.custody, 'master_key');
  assert.strictEqual(user.raw_password, null);
  assert.strictEqual(user.registration_email, 'jane.doe@example.com');

  const secretKey = decrypt(user.private_key_encrypted, TEST_MASTER_KEY);
  assert.strictEqual(getPublicKey(secretKey).toLowerCase(), data.pubkey);
});

// Accounts: repeat calls for the same (tenant, email) return the same account.
test('POST /api/v1/service/accounts is idempotent per tenant and email', async () => {
  const first = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'repeat@example.com', tenant_domain: TEST_TENANT },
    serviceHeaders()
  );
  const second = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'repeat@example.com', tenant_domain: TEST_TENANT },
    serviceHeaders()
  );

  assert.strictEqual(first.status, 201);
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.data.created, false);
  assert.strictEqual(second.data.username, first.data.username);
  assert.strictEqual(second.data.pubkey, first.data.pubkey);
});

// Accounts: input validation.
test('POST /api/v1/service/accounts validates email and tenant_domain', async () => {
  const badEmail = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'not-an-email', tenant_domain: TEST_TENANT },
    serviceHeaders()
  );
  assert.strictEqual(badEmail.status, 400);

  const missingTenant = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'valid@example.com' },
    serviceHeaders()
  );
  assert.strictEqual(missingTenant.status, 400);
});

});
