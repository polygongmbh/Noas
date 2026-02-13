/**
 * Authentication Module Tests
 * 
 * Tests for password hashing, verification, and input validation functions.
 * Covers username, public key, and encrypted key validation.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { 
  hashPassword, 
  verifyPassword, 
  validateUsername, 
  validatePublicKey,
  validateEncryptedPrivateKey 
} from './auth.js';

// Test: Password hashing creates a valid bcrypt hash
test('hashPassword creates a hash', async () => {
  const hash = await hashPassword('testpassword123');
  assert.ok(hash);
  assert.ok(hash.startsWith('$2'));
  assert.notEqual(hash, 'testpassword123');
});

// Test: Password verification succeeds with correct password
test('verifyPassword validates correct password', async () => {
  const password = 'testpassword123';
  const hash = await hashPassword(password);
  const valid = await verifyPassword(password, hash);
  assert.strictEqual(valid, true);
});

// Test: Password verification fails with incorrect password
test('verifyPassword rejects wrong password', async () => {
  const hash = await hashPassword('testpassword123');
  const valid = await verifyPassword('wrongpassword', hash);
  assert.strictEqual(valid, false);
});

// Test: Username validation accepts valid formats
test('validateUsername accepts valid usernames', () => {
  assert.strictEqual(validateUsername('alice').valid, true);
  assert.strictEqual(validateUsername('bob_123').valid, true);
  assert.strictEqual(validateUsername('test').valid, true);
});

// Test: Username validation rejects invalid formats (too short, too long, uppercase, special chars)
test('validateUsername rejects invalid usernames', () => {
  assert.strictEqual(validateUsername('ab').valid, false); // too short
  assert.strictEqual(validateUsername('a'.repeat(33)).valid, false); // too long
  assert.strictEqual(validateUsername('Alice').valid, false); // uppercase
  assert.strictEqual(validateUsername('alice-bob').valid, false); // hyphen
  assert.strictEqual(validateUsername('').valid, false); // empty
});

// Test: Public key validation accepts 64-character hex strings
test('validatePublicKey accepts valid hex keys', () => {
  const validKey = 'a'.repeat(64);
  assert.strictEqual(validatePublicKey(validKey).valid, true);
});

// Test: Public key validation rejects invalid formats (wrong length, invalid hex)
test('validatePublicKey rejects invalid keys', () => {
  assert.strictEqual(validatePublicKey('short').valid, false);
  assert.strictEqual(validatePublicKey('z'.repeat(64)).valid, false); // invalid hex
  assert.strictEqual(validatePublicKey('').valid, false);
});

// Test: Encrypted key validation accepts NIP-49 format (ncryptsec prefix)
test('validateEncryptedPrivateKey accepts NIP-49 format', () => {
  const validKey = 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p';
  assert.strictEqual(validateEncryptedPrivateKey(validKey).valid, true);
});

// Test: Encrypted key validation rejects invalid formats (wrong prefix, empty)
test('validateEncryptedPrivateKey rejects invalid format', () => {
  assert.strictEqual(validateEncryptedPrivateKey('nsec1...').valid, false);
  assert.strictEqual(validateEncryptedPrivateKey('invalid').valid, false);
  assert.strictEqual(validateEncryptedPrivateKey('').valid, false);
});
