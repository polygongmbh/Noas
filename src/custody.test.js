/**
 * Key Custody Tests
 *
 * Tests decryption-secret resolution and key unlocking for both custody
 * modes ('password' and 'master_key'), including NIP-46 remote signing
 * with a master-key custodial account.
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { getPublicKey, verifyEvent } from 'nostr-tools';
import { encrypt } from 'nostr-tools/nip49';

const TEST_MASTER_KEY = 'custody-test-master-key-secret';
process.env.CUSTODY_MASTER_KEY = TEST_MASTER_KEY;

const { CUSTODY_MODES, UNLOCK_ERRORS, resolveSigningSecret, unlockNostrUserSecretKey } =
  await import('./custody.js');
const { handleConnect, handleSignEvent, signerPubkey } = await import('./nip46.js');
const { createNostrUser } = await import('./db/users.js');
const { pool } = await import('./db/pool.js');

const testSecretKey = Uint8Array.from(Buffer.from('5'.repeat(64), 'hex'));
const testPublicKey = getPublicKey(testSecretKey).toLowerCase();
const testRawPassword = 'legacy-signup-password';

const custodialUser = {
  username: 'custodytestuser',
  publicKey: testPublicKey,
  privateKeyEncrypted: encrypt(testSecretKey, TEST_MASTER_KEY),
};

// Valid secp256k1 public key for testing
const testClientPubkey = 'eaed797c2c94d7eb2748d00d823c2b61c7a2e93a9f8b748b4e8e1e51e6c3b4e6';

describe('Custody Secret Resolution', () => {
  it('resolveSigningSecret returns raw_password for password custody', () => {
    const user = { custody: CUSTODY_MODES.PASSWORD, raw_password: testRawPassword };
    assert.equal(resolveSigningSecret(user), testRawPassword);
  });

  it('resolveSigningSecret returns null for password custody without raw_password', () => {
    const user = { custody: CUSTODY_MODES.PASSWORD, raw_password: null };
    assert.equal(resolveSigningSecret(user), null);
  });

  it('resolveSigningSecret returns the master key for master_key custody', () => {
    const user = { custody: CUSTODY_MODES.MASTER_KEY, raw_password: null };
    assert.equal(resolveSigningSecret(user), TEST_MASTER_KEY);
  });

  it('resolveSigningSecret ignores raw_password for master_key custody', () => {
    const user = { custody: CUSTODY_MODES.MASTER_KEY, raw_password: testRawPassword };
    assert.equal(resolveSigningSecret(user), TEST_MASTER_KEY);
  });
});

describe('Key Unlocking', () => {
  it('unlocks a password-custody account with its raw password', () => {
    const user = {
      custody: CUSTODY_MODES.PASSWORD,
      raw_password: testRawPassword,
      public_key: testPublicKey,
      private_key_encrypted: encrypt(testSecretKey, testRawPassword),
    };

    const unlocked = unlockNostrUserSecretKey(user);
    assert.equal(unlocked.error, undefined);
    assert.equal(unlocked.publicKey, testPublicKey);
    assert.deepEqual(unlocked.secretKey, testSecretKey);
  });

  it('unlocks a master_key-custody account with the master key', () => {
    const user = {
      custody: CUSTODY_MODES.MASTER_KEY,
      raw_password: null,
      public_key: custodialUser.publicKey,
      private_key_encrypted: custodialUser.privateKeyEncrypted,
    };

    const unlocked = unlockNostrUserSecretKey(user);
    assert.equal(unlocked.error, undefined);
    assert.equal(unlocked.publicKey, custodialUser.publicKey);
    assert.deepEqual(unlocked.secretKey, testSecretKey);
  });

  it('reports unavailable when no decryption secret exists', () => {
    const user = {
      custody: CUSTODY_MODES.PASSWORD,
      raw_password: null,
      public_key: testPublicKey,
      private_key_encrypted: custodialUser.privateKeyEncrypted,
    };

    assert.equal(unlockNostrUserSecretKey(user).error, UNLOCK_ERRORS.UNAVAILABLE);
  });

  it('reports unlock_failed when the secret does not decrypt the key', () => {
    const user = {
      custody: CUSTODY_MODES.PASSWORD,
      raw_password: 'wrong-password',
      public_key: testPublicKey,
      private_key_encrypted: custodialUser.privateKeyEncrypted,
    };

    assert.equal(unlockNostrUserSecretKey(user).error, UNLOCK_ERRORS.UNLOCK_FAILED);
  });

  it('reports pubkey_mismatch when the key does not match the account', () => {
    const user = {
      custody: CUSTODY_MODES.MASTER_KEY,
      raw_password: null,
      public_key: 'b'.repeat(64),
      private_key_encrypted: custodialUser.privateKeyEncrypted,
    };

    assert.equal(unlockNostrUserSecretKey(user).error, UNLOCK_ERRORS.PUBKEY_MISMATCH);
  });
});

let dbAvailable = true;
try {
  await pool.query('SELECT 1');
} catch (error) {
  dbAvailable = false;
  console.warn('[custody.test] Skipping DB tests: database unavailable:', error.code || error.message);
}

describe('NIP-46 Signing With Master-Key Custody', { skip: !dbAvailable }, () => {
  before(async () => {
    await pool.query('DELETE FROM nostr_users WHERE username = $1', [custodialUser.username]);
    await createNostrUser({
      username: custodialUser.username,
      passwordSha256: 'a'.repeat(64),
      publicKey: custodialUser.publicKey,
      privateKeyEncrypted: custodialUser.privateKeyEncrypted,
      rawPassword: null,
      relays: [],
      status: 'active',
      verificationToken: null,
      custody: CUSTODY_MODES.MASTER_KEY,
    });
  });

  after(async () => {
    await pool.query(
      'DELETE FROM nip46_sessions WHERE client_pubkey = $1',
      [testClientPubkey]
    );
    await pool.query('DELETE FROM nostr_users WHERE username = $1', [custodialUser.username]);
    await pool.end();
  });

  it('handleSignEvent signs with the master-key custodial account', async () => {
    const connectRequest = {
      id: 'custody-connect',
      method: 'connect',
      params: [signerPubkey, 'secret'],
    };
    const connectResponse = await handleConnect(connectRequest, testClientPubkey, custodialUser.username);
    assert.equal(connectResponse.error, null);

    const session = await pool.query(
      'SELECT session_id FROM nip46_sessions WHERE client_pubkey = $1 ORDER BY created_at DESC LIMIT 1',
      [testClientPubkey]
    );
    const sessionId = session.rows[0]?.session_id;
    assert.ok(sessionId);

    const eventToSign = {
      kind: 1,
      content: 'Signed under master-key custody',
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };
    const requestData = {
      id: 'custody-sign-123',
      method: 'sign_event',
      params: [JSON.stringify(eventToSign)],
    };

    const response = await handleSignEvent(requestData, sessionId);

    assert.equal(response.error, null);
    const signedEvent = JSON.parse(response.result);
    assert.equal(signedEvent.pubkey, custodialUser.publicKey);
    assert.equal(signedEvent.content, eventToSign.content);
    assert.ok(verifyEvent(signedEvent));
  });
});
