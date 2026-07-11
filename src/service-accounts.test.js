/**
 * Service Account Provisioning Tests
 *
 * Tests username derivation from subscriber emails and custodial account
 * provisioning (master-key custody, idempotency, collision handling).
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { getPublicKey } from 'nostr-tools';
import { decrypt } from 'nostr-tools/nip49';

const TEST_MASTER_KEY = 'service-accounts-test-master-key';
process.env.CUSTODY_MASTER_KEY = TEST_MASTER_KEY;
process.env.DISALLOWED_USERNAMES = 'relay';

const { deriveUsernameBaseFromEmail, provisionServiceAccount } =
  await import('./service-accounts.js');
const { CUSTODY_MODES } = await import('./custody.js');
const { createNostrUser } = await import('./db/users.js');
const { pool } = await import('./db/pool.js');

const TEST_TENANT = 'service-accounts.test';

describe('Username Derivation', () => {
  it('lowercases the email local part', () => {
    assert.equal(deriveUsernameBaseFromEmail('Jane.Doe@example.com'), 'jane.doe');
  });

  it('strips characters outside a-z0-9-_.', () => {
    assert.equal(deriveUsernameBaseFromEmail('jane+news!@example.com'), 'janenews');
  });

  it('pads short local parts to the minimum username length', () => {
    assert.equal(deriveUsernameBaseFromEmail('jo@example.com'), 'jo0');
  });

  it('trims long local parts to the maximum username length', () => {
    const longLocalPart = 'a'.repeat(40);
    assert.equal(deriveUsernameBaseFromEmail(`${longLocalPart}@example.com`), 'a'.repeat(32));
  });

  it('falls back when the local part has no allowed characters', () => {
    assert.equal(deriveUsernameBaseFromEmail('=?*@example.com'), 'subscriber');
  });
});

let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch (error) {
  dbAvailable = false;
  console.warn('[service-accounts.test] Skipping DB tests: database unavailable:', error.code || error.message);
}

describe('Service Account Provisioning', { skip: !dbAvailable }, () => {
  before(async () => {
    await pool.query('DELETE FROM nostr_users WHERE tenant_domain = $1', [TEST_TENANT]);
  });

  after(async () => {
    await pool.query('DELETE FROM nostr_users WHERE tenant_domain = $1', [TEST_TENANT]);
    await pool.end();
  });

  it('provisions an active custodial account with a master-key encrypted key', async () => {
    const { user, created } = await provisionServiceAccount({
      email: 'subscriber@example.com',
      tenantDomain: TEST_TENANT,
    });

    assert.equal(created, true);
    assert.equal(user.username, 'subscriber');
    assert.equal(user.tenant_domain, TEST_TENANT);
    assert.equal(user.status, 'active');
    assert.equal(user.custody, CUSTODY_MODES.MASTER_KEY);
    assert.equal(user.raw_password, null);
    assert.equal(user.registration_email, 'subscriber@example.com');
    assert.match(user.public_key, /^[a-f0-9]{64}$/);
    assert.ok(user.private_key_encrypted.startsWith('ncryptsec'));

    const secretKey = decrypt(user.private_key_encrypted, TEST_MASTER_KEY);
    assert.equal(getPublicKey(secretKey).toLowerCase(), user.public_key);
  });

  it('is idempotent per (tenant_domain, email)', async () => {
    const first = await provisionServiceAccount({
      email: 'repeat@example.com',
      tenantDomain: TEST_TENANT,
    });
    const second = await provisionServiceAccount({
      email: 'repeat@example.com',
      tenantDomain: TEST_TENANT,
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.user.username, first.user.username);
    assert.equal(second.user.public_key, first.user.public_key);
  });

  it('adds a numeric suffix when the derived username is taken', async () => {
    await createNostrUser({
      tenantDomain: TEST_TENANT,
      username: 'taken',
      passwordSha256: 'b'.repeat(64),
      status: 'active',
    });

    const { user } = await provisionServiceAccount({
      email: 'taken@another.example',
      tenantDomain: TEST_TENANT,
    });
    assert.equal(user.username, 'taken1');

    const next = await provisionServiceAccount({
      email: 'taken@third.example',
      tenantDomain: TEST_TENANT,
    });
    assert.equal(next.user.username, 'taken2');
  });

  it('skips reserved usernames via numeric suffix', async () => {
    // 'relay' is reserved via DISALLOWED_USERNAMES above
    const { user } = await provisionServiceAccount({
      email: 'relay@example.com',
      tenantDomain: TEST_TENANT,
    });
    assert.equal(user.username, 'relay1');
  });
});
