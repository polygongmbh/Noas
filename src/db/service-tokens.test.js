/**
 * Service Token Database Operations Tests
 *
 * Tests single-use magic link tokens and sliding-expiry session tokens
 * against the magic_link_tokens and session_tokens tables.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import { query, closePool } from './pool.js';
import { createNostrUser } from './users.js';
import {
  createMagicLinkToken,
  getMagicLinkToken,
  consumeMagicLinkToken,
  deleteExpiredMagicLinkTokens,
} from './magic-links.js';
import {
  createSessionToken,
  touchSessionToken,
  deleteSessionToken,
  deleteExpiredSessionTokens,
} from './sessions.js';

const TEST_TENANT = 'service-tokens.test';

let dbAvailable = true;
try {
  await query('SELECT 1');
} catch (error) {
  dbAvailable = false;
  console.warn('[service-tokens.test] Skipping DB tests: database unavailable:', error.code || error.message);
}

describe('Service Token Database Operations', { skip: !dbAvailable }, () => {

let userId;

before(async () => {
  await query('DELETE FROM nostr_users WHERE tenant_domain = $1', [TEST_TENANT]);
  const user = await createNostrUser({
    tenantDomain: TEST_TENANT,
    username: 'tokentestuser',
    passwordSha256: 'c'.repeat(64),
    status: 'active',
  });
  userId = user.id;
});

after(async () => {
  // Token rows cascade with the user
  await query('DELETE FROM nostr_users WHERE tenant_domain = $1', [TEST_TENANT]);
  await closePool();
});

test('createMagicLinkToken stores a token with purpose and expiry', async () => {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const created = await createMagicLinkToken({
    token: 'magic-token-create',
    userId,
    tenantDomain: TEST_TENANT,
    purpose: 'login',
    expiresAt,
  });

  assert.ok(created.id);
  assert.strictEqual(created.purpose, 'login');
  assert.strictEqual(created.used_at, null);

  const fetched = await getMagicLinkToken('magic-token-create');
  assert.strictEqual(fetched.user_id, userId);
});

test('consumeMagicLinkToken succeeds once and only once', async () => {
  await createMagicLinkToken({
    token: 'magic-token-single-use',
    userId,
    tenantDomain: TEST_TENANT,
    purpose: 'confirm',
    expiresAt: new Date(Date.now() + 60 * 1000),
  });

  const first = await consumeMagicLinkToken('magic-token-single-use');
  assert.ok(first);
  assert.ok(first.used_at);

  const second = await consumeMagicLinkToken('magic-token-single-use');
  assert.strictEqual(second, undefined);
});

test('consumeMagicLinkToken rejects expired tokens', async () => {
  await createMagicLinkToken({
    token: 'magic-token-expired',
    userId,
    tenantDomain: TEST_TENANT,
    purpose: 'login',
    expiresAt: new Date(Date.now() - 60 * 1000),
  });

  const consumed = await consumeMagicLinkToken('magic-token-expired');
  assert.strictEqual(consumed, undefined);
});

test('deleteExpiredMagicLinkTokens removes only expired tokens', async () => {
  await createMagicLinkToken({
    token: 'magic-token-stale',
    userId,
    tenantDomain: TEST_TENANT,
    purpose: 'login',
    expiresAt: new Date(Date.now() - 60 * 1000),
  });
  await createMagicLinkToken({
    token: 'magic-token-fresh',
    userId,
    tenantDomain: TEST_TENANT,
    purpose: 'login',
    expiresAt: new Date(Date.now() + 60 * 1000),
  });

  const deleted = await deleteExpiredMagicLinkTokens();
  assert.ok(deleted >= 1);
  assert.strictEqual(await getMagicLinkToken('magic-token-stale'), undefined);
  assert.ok(await getMagicLinkToken('magic-token-fresh'));
});

test('touchSessionToken slides the expiry forward', async () => {
  const initialExpiry = new Date(Date.now() + 60 * 1000);
  await createSessionToken({
    token: 'session-token-sliding',
    userId,
    expiresAt: initialExpiry,
  });

  const touched = await touchSessionToken('session-token-sliding', 30);
  assert.ok(touched);
  const slidExpiry = new Date(touched.expires_at).getTime();
  assert.ok(slidExpiry > initialExpiry.getTime());
  assert.ok(slidExpiry > Date.now() + 29 * 24 * 60 * 60 * 1000);
});

test('touchSessionToken rejects expired sessions', async () => {
  await createSessionToken({
    token: 'session-token-expired',
    userId,
    expiresAt: new Date(Date.now() - 60 * 1000),
  });

  const touched = await touchSessionToken('session-token-expired', 30);
  assert.strictEqual(touched, undefined);
});

test('deleteSessionToken revokes a session', async () => {
  await createSessionToken({
    token: 'session-token-logout',
    userId,
    expiresAt: new Date(Date.now() + 60 * 1000),
  });

  const deleted = await deleteSessionToken('session-token-logout');
  assert.ok(deleted);
  assert.strictEqual(await touchSessionToken('session-token-logout', 30), undefined);
});

test('deleteExpiredSessionTokens removes only expired sessions', async () => {
  await createSessionToken({
    token: 'session-token-stale',
    userId,
    expiresAt: new Date(Date.now() - 60 * 1000),
  });
  await createSessionToken({
    token: 'session-token-fresh',
    userId,
    expiresAt: new Date(Date.now() + 60 * 1000),
  });

  const deleted = await deleteExpiredSessionTokens();
  assert.ok(deleted >= 1);
  const staleRow = await query('SELECT * FROM session_tokens WHERE token = $1', ['session-token-stale']);
  assert.strictEqual(staleRow.rows.length, 0);
  const freshRow = await query('SELECT * FROM session_tokens WHERE token = $1', ['session-token-fresh']);
  assert.strictEqual(freshRow.rows.length, 1);
});

});
