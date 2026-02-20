/**
 * User Database Operations Tests
 * 
 * Tests all CRUD operations for the users table.
 * Uses a test user and cleans up data before and after tests.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { pool, query, closePool } from './pool.js';
import { 
  createUser, 
  getUserByUsername, 
  getUserForNip05, 
  updateUser,
  updateUserProfilePicture,
  getUserProfilePictureByPublicKey,
} from './users.js';

// Test user data used across all tests
const testUser = {
  username: 'testuser',
  publicKey: 'a'.repeat(64),
  encryptedPrivateKey: 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p',
  passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
  relays: ['wss://relay.example.com'],
};

// Setup: Clean up any existing test data before running tests
before(async () => {
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

  // Clean up any existing test data
  await query('DELETE FROM users WHERE username = $1', [testUser.username]);
});

// Teardown: Clean up test data and close database connection
after(async () => {
  // Clean up test data
  await query('DELETE FROM users WHERE username = $1', [testUser.username]);
  await closePool();
});

// Test: Creating a new user inserts into database and returns user data
test('createUser inserts a new user', async () => {
  const user = await createUser(testUser);
  
  assert.ok(user.id);
  assert.strictEqual(user.username, testUser.username);
  assert.strictEqual(user.public_key, testUser.publicKey);
  assert.ok(user.created_at);
});

// Test: Retrieving user by username returns all user data
test('getUserByUsername retrieves user', async () => {
  const user = await getUserByUsername(testUser.username);
  
  assert.ok(user);
  assert.strictEqual(user.username, testUser.username);
  assert.strictEqual(user.public_key, testUser.publicKey);
  assert.strictEqual(user.encrypted_private_key, testUser.encryptedPrivateKey);
  assert.strictEqual(user.password_hash, testUser.passwordHash);
});

// Test: getUserByUsername returns undefined when user doesn't exist
test('getUserByUsername returns undefined for non-existent user', async () => {
  const user = await getUserByUsername('nonexistent');
  assert.strictEqual(user, undefined);
});

// Test: NIP-05 endpoint retrieves only public data (no sensitive fields)
test('getUserForNip05 returns only username and public key', async () => {
  const user = await getUserForNip05(testUser.username);
  
  assert.ok(user);
  assert.strictEqual(user.username, testUser.username);
  assert.strictEqual(user.public_key, testUser.publicKey);
  assert.strictEqual(user.password_hash, undefined);
  assert.strictEqual(user.encrypted_private_key, undefined);
});

// Test: Updating password hash changes the stored hash
test('updateUser updates password hash', async () => {
  const newHash = '$2b$10$newhashvalue';
  const updated = await updateUser(testUser.username, { passwordHash: newHash });
  
  assert.ok(updated);
  const user = await getUserByUsername(testUser.username);
  assert.strictEqual(user.password_hash, newHash);
});

// Test: Updating relays changes the relay list in database
test('updateUser updates relays', async () => {
  const newRelays = ['wss://relay1.com', 'wss://relay2.com'];
  await updateUser(testUser.username, { relays: newRelays });
  
  const user = await getUserByUsername(testUser.username);
  assert.deepStrictEqual(user.relays, newRelays);
});

// Test: Updating profile picture stores image data and type
test('updateUserProfilePicture stores profile picture', async () => {
  const pictureData = Buffer.from([0, 1, 2, 3, 4]);
  const pictureType = 'image/png';
  await updateUserProfilePicture(testUser.username, pictureData, pictureType);

  const stored = await getUserProfilePictureByPublicKey(testUser.publicKey);
  assert.ok(stored);
  assert.strictEqual(stored.profile_picture_type, pictureType);
  assert.deepStrictEqual(stored.profile_picture, pictureData);
});
