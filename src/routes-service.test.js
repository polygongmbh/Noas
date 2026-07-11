/**
 * Service API Routes Integration Tests
 *
 * End-to-end tests of the service endpoints used by trusted services
 * (e.g. nail): service-key auth, custodial account provisioning, magic
 * link tokens, and bearer sessions.
 * Uses a separate test server on port 3004.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import { getPublicKey, generateSecretKey, verifyEvent } from 'nostr-tools';
import { decrypt, encrypt } from 'nostr-tools/nip49';

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

// Magic links: issuing tokens for both purposes with the documented TTLs.
test('POST /api/v1/service/magic-links issues single-use tokens', async () => {
  await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'magic@example.com', tenant_domain: TEST_TENANT },
    serviceHeaders()
  );

  const login = await request(
    'POST',
    '/api/v1/service/magic-links',
    { email: 'magic@example.com', tenant_domain: TEST_TENANT, purpose: 'login' },
    serviceHeaders()
  );
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.data.success, true);
  assert.match(login.data.token, /^[a-f0-9]{64}$/);
  const loginTtlMs = new Date(login.data.expires_at).getTime() - Date.now();
  assert.ok(loginTtlMs > 25 * 60 * 1000 && loginTtlMs <= 30 * 60 * 1000);

  const confirm = await request(
    'POST',
    '/api/v1/service/magic-links',
    { email: 'magic@example.com', tenant_domain: TEST_TENANT, purpose: 'confirm' },
    serviceHeaders()
  );
  assert.strictEqual(confirm.status, 200);
  const confirmTtlMs = new Date(confirm.data.expires_at).getTime() - Date.now();
  assert.ok(confirmTtlMs > 6 * 24 * 60 * 60 * 1000 && confirmTtlMs <= 7 * 24 * 60 * 60 * 1000);
});

// Magic links: input validation and unknown accounts.
test('POST /api/v1/service/magic-links rejects bad purpose and unknown email', async () => {
  const badPurpose = await request(
    'POST',
    '/api/v1/service/magic-links',
    { email: 'magic@example.com', tenant_domain: TEST_TENANT, purpose: 'reset' },
    serviceHeaders()
  );
  assert.strictEqual(badPurpose.status, 400);

  const unknown = await request(
    'POST',
    '/api/v1/service/magic-links',
    { email: 'nobody@example.com', tenant_domain: TEST_TENANT, purpose: 'login' },
    serviceHeaders()
  );
  assert.strictEqual(unknown.status, 404);
});

// Magic verify: exchanging a token for a session, single use.
test('POST /api/v1/auth/magic/verify exchanges a token for a session once', async () => {
  const account = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'verify@example.com', tenant_domain: TEST_TENANT },
    serviceHeaders()
  );
  const magicLink = await request(
    'POST',
    '/api/v1/service/magic-links',
    { email: 'verify@example.com', tenant_domain: TEST_TENANT, purpose: 'login' },
    serviceHeaders()
  );

  const verify = await request('POST', '/api/v1/auth/magic/verify', {
    token: magicLink.data.token,
  });
  assert.strictEqual(verify.status, 200);
  assert.strictEqual(verify.data.success, true);
  assert.match(verify.data.session_token, /^[a-f0-9]{64}$/);
  assert.strictEqual(verify.data.username, account.data.username);
  assert.strictEqual(verify.data.pubkey, account.data.pubkey);
  assert.strictEqual(verify.data.purpose, 'login');
  const sessionTtlMs = new Date(verify.data.expires_at).getTime() - Date.now();
  assert.ok(sessionTtlMs > 29 * 24 * 60 * 60 * 1000);

  const replay = await request('POST', '/api/v1/auth/magic/verify', {
    token: magicLink.data.token,
  });
  assert.strictEqual(replay.status, 410);

  const garbage = await request('POST', '/api/v1/auth/magic/verify', {
    token: 'f'.repeat(64),
  });
  assert.strictEqual(garbage.status, 404);
});

// Magic verify: expired tokens are rejected.
test('POST /api/v1/auth/magic/verify rejects expired tokens', async () => {
  const magicLink = await request(
    'POST',
    '/api/v1/service/magic-links',
    { email: 'verify@example.com', tenant_domain: TEST_TENANT, purpose: 'login' },
    serviceHeaders()
  );
  await pool.query(
    "UPDATE magic_link_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token = $1",
    [magicLink.data.token]
  );

  const verify = await request('POST', '/api/v1/auth/magic/verify', {
    token: magicLink.data.token,
  });
  assert.strictEqual(verify.status, 410);
});

// Sessions: bearer token resolves to account info with sliding expiry.
test('GET /api/v1/auth/session returns account info and slides expiry', async () => {
  const account = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'session@example.com', tenant_domain: TEST_TENANT },
    serviceHeaders()
  );
  const magicLink = await request(
    'POST',
    '/api/v1/service/magic-links',
    { email: 'session@example.com', tenant_domain: TEST_TENANT, purpose: 'login' },
    serviceHeaders()
  );
  const verify = await request('POST', '/api/v1/auth/magic/verify', {
    token: magicLink.data.token,
  });
  const sessionToken = verify.data.session_token;

  // Age the session so the sliding refresh is observable.
  await pool.query(
    "UPDATE session_tokens SET expires_at = NOW() + INTERVAL '1 day' WHERE token = $1",
    [sessionToken]
  );

  const info = await request('GET', '/api/v1/auth/session', null, {
    Authorization: `Bearer ${sessionToken}`,
  });
  assert.strictEqual(info.status, 200);
  assert.strictEqual(info.data.username, account.data.username);
  assert.strictEqual(info.data.pubkey, account.data.pubkey);
  assert.strictEqual(info.data.tenant_domain, TEST_TENANT);
  assert.strictEqual(info.data.registration_email, 'session@example.com');
  const ttlMs = new Date(info.data.expires_at).getTime() - Date.now();
  assert.ok(ttlMs > 29 * 24 * 60 * 60 * 1000, 'expiry should slide back to 30 days');

  const noToken = await request('GET', '/api/v1/auth/session');
  assert.strictEqual(noToken.status, 401);

  const badToken = await request('GET', '/api/v1/auth/session', null, {
    Authorization: `Bearer ${'e'.repeat(64)}`,
  });
  assert.strictEqual(badToken.status, 401);
});

// Sessions: logout revokes the token.
test('DELETE /api/v1/auth/session logs out', async () => {
  const magicLink = await request(
    'POST',
    '/api/v1/service/magic-links',
    { email: 'session@example.com', tenant_domain: TEST_TENANT, purpose: 'login' },
    serviceHeaders()
  );
  const verify = await request('POST', '/api/v1/auth/magic/verify', {
    token: magicLink.data.token,
  });
  const sessionToken = verify.data.session_token;

  const logout = await request('DELETE', '/api/v1/auth/session', null, {
    Authorization: `Bearer ${sessionToken}`,
  });
  assert.strictEqual(logout.status, 200);
  assert.strictEqual(logout.data.success, true);

  const afterLogout = await request('GET', '/api/v1/auth/session', null, {
    Authorization: `Bearer ${sessionToken}`,
  });
  assert.strictEqual(afterLogout.status, 401);
});

// Sign: service key signs an event template with the custodial key.
test('POST /api/v1/service/sign signs an event for a custodial account', async () => {
  const account = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'signer@example.com', tenant_domain: TEST_TENANT },
    serviceHeaders()
  );

  const template = {
    kind: 1,
    content: 'Signed by the noas service API',
    tags: [['t', 'nail']],
    created_at: Math.floor(Date.now() / 1000) - 5,
  };
  const { status, data } = await request(
    'POST',
    '/api/v1/service/sign',
    { username: account.data.username, tenant_domain: TEST_TENANT, event: template },
    serviceHeaders()
  );

  assert.strictEqual(status, 200);
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.event.kind, template.kind);
  assert.strictEqual(data.event.content, template.content);
  assert.deepStrictEqual(data.event.tags, template.tags);
  assert.strictEqual(data.event.created_at, template.created_at);
  assert.strictEqual(data.event.pubkey, account.data.pubkey);
  assert.ok(data.event.id);
  assert.ok(data.event.sig);
  assert.ok(verifyEvent(data.event));
});

// Sign: created_at defaults to now when omitted.
test('POST /api/v1/service/sign fills created_at when omitted', async () => {
  const { status, data } = await request(
    'POST',
    '/api/v1/service/sign',
    {
      username: 'signer',
      tenant_domain: TEST_TENANT,
      event: { kind: 0, content: '{"name":"signer"}' },
    },
    serviceHeaders()
  );

  assert.strictEqual(status, 200);
  assert.ok(Math.abs(data.event.created_at - Math.floor(Date.now() / 1000)) < 10);
  assert.deepStrictEqual(data.event.tags, []);
  assert.ok(verifyEvent(data.event));
});

// Sign: template validation.
test('POST /api/v1/service/sign validates the event template', async () => {
  const missingKind = await request(
    'POST',
    '/api/v1/service/sign',
    { username: 'signer', tenant_domain: TEST_TENANT, event: { content: 'x' } },
    serviceHeaders()
  );
  assert.strictEqual(missingKind.status, 400);

  const badTags = await request(
    'POST',
    '/api/v1/service/sign',
    { username: 'signer', tenant_domain: TEST_TENANT, event: { kind: 1, tags: ['t'] } },
    serviceHeaders()
  );
  assert.strictEqual(badTags.status, 400);

  const unknownUser = await request(
    'POST',
    '/api/v1/service/sign',
    { username: 'ghostuser', tenant_domain: TEST_TENANT, event: { kind: 1 } },
    serviceHeaders()
  );
  assert.strictEqual(unknownUser.status, 404);
});

// Sign: non-custodial (password custody) accounts are rejected.
test('POST /api/v1/service/sign rejects non-custodial accounts', async () => {
  const { createNostrUser } = await import('./db/users.js');
  const secretKey = generateSecretKey();
  await createNostrUser({
    tenantDomain: TEST_TENANT,
    username: 'legacyuser',
    passwordSha256: 'd'.repeat(64),
    publicKey: getPublicKey(secretKey).toLowerCase(),
    privateKeyEncrypted: encrypt(secretKey, 'legacy-password'),
    rawPassword: 'legacy-password',
    status: 'active',
  });

  const { status, data } = await request(
    'POST',
    '/api/v1/service/sign',
    { username: 'legacyuser', tenant_domain: TEST_TENANT, event: { kind: 1, content: 'no' } },
    serviceHeaders()
  );

  assert.strictEqual(status, 403);
  assert.ok(data.error);
});

// Sign: a subscriber session token works in place of the service key,
// but only for the session's own account.
test('POST /api/v1/service/sign accepts a matching bearer session', async () => {
  const account = await request(
    'POST',
    '/api/v1/service/accounts',
    { email: 'sessionsigner@example.com', tenant_domain: TEST_TENANT },
    serviceHeaders()
  );
  const magicLink = await request(
    'POST',
    '/api/v1/service/magic-links',
    { email: 'sessionsigner@example.com', tenant_domain: TEST_TENANT, purpose: 'login' },
    serviceHeaders()
  );
  const verify = await request('POST', '/api/v1/auth/magic/verify', {
    token: magicLink.data.token,
  });
  const bearer = { Authorization: `Bearer ${verify.data.session_token}` };

  const own = await request(
    'POST',
    '/api/v1/service/sign',
    {
      username: account.data.username,
      tenant_domain: TEST_TENANT,
      event: { kind: 1, content: 'signed via session' },
    },
    bearer
  );
  assert.strictEqual(own.status, 200);
  assert.strictEqual(own.data.event.pubkey, account.data.pubkey);
  assert.ok(verifyEvent(own.data.event));

  const other = await request(
    'POST',
    '/api/v1/service/sign',
    { username: 'signer', tenant_domain: TEST_TENANT, event: { kind: 1, content: 'nope' } },
    bearer
  );
  assert.strictEqual(other.status, 403);

  const invalidBearer = await request(
    'POST',
    '/api/v1/service/sign',
    { username: account.data.username, tenant_domain: TEST_TENANT, event: { kind: 1 } },
    { Authorization: `Bearer ${'a'.repeat(64)}` }
  );
  assert.strictEqual(invalidBearer.status, 401);
});

// Sign: no service key and no bearer token is rejected by the gate.
test('POST /api/v1/service/sign rejects unauthenticated requests', async () => {
  const { status } = await request('POST', '/api/v1/service/sign', {
    username: 'signer',
    tenant_domain: TEST_TENANT,
    event: { kind: 1 },
  });
  assert.strictEqual(status, 401);
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
