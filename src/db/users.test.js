/**
 * User Database Operations Tests
 * 
 * Tests all CRUD operations for the users table.
 * Uses a test user and cleans up data before and after tests.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert';
import { pool, query, closePool } from './pool.js';
import { 
  createUser, 
  getUserByUsername, 
  getUserForNip05, 
  updateUser,
  updateUserProfilePicture,
  getUserProfilePictureByPublicKey,
  upsertUserOnboarding,
  getUserOnboardingByUsername,
  markUserOnboardingEmailVerified,
  incrementUserOnboardingPinAttempt,
  deleteUserOnboarding,
} from './users.js';

// Test user data used across all tests
const testUser = {
  username: 'testuser',
  publicKey: 'a'.repeat(64),
  encryptedPrivateKey: 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p',
  passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
  relays: ['wss://relay.example.com'],
};

let dbAvailable = true;
try {
  await query('SELECT 1');
} catch (error) {
  dbAvailable = false;
  console.warn('[users.test] Skipping DB tests: database unavailable:', error.code || error.message);
}

describe('User Database Operations', { skip: !dbAvailable }, () => {

// Setup: Clean up any existing test data before running tests
before(async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS user_onboarding (
      id SERIAL PRIMARY KEY,
      username VARCHAR(32) UNIQUE NOT NULL,
      email VARCHAR(320) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      relays JSONB DEFAULT '[]'::jsonb,
      email_verification_token VARCHAR(128) NOT NULL,
      email_verification_pin_hash VARCHAR(255) NOT NULL,
      email_verification_expires_at TIMESTAMP NOT NULL,
      email_verified_at TIMESTAMP,
      pin_attempt_count INTEGER NOT NULL DEFAULT 0,
      verification_origin TEXT,
      public_key VARCHAR(64),
      encrypted_private_key TEXT,
      last_email_sent_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS used_verification_tokens (
      token VARCHAR(128) PRIMARY KEY,
      used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

  // Clean up any existing test data
  await query('DELETE FROM users WHERE username = $1', [testUser.username]);
  await query('DELETE FROM user_onboarding WHERE username = $1', [testUser.username]);
});

// Teardown: Clean up test data and close database connection
after(async () => {
  // Clean up test data
  await query('DELETE FROM users WHERE username = $1', [testUser.username]);
  await query('DELETE FROM user_onboarding WHERE username = $1', [testUser.username]);
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
  // Ensure the user exists first
  const existingUser = await getUserByUsername(testUser.username);
  if (!existingUser) {
    await createUser(testUser);
  }
  
  const pictureData = Buffer.from([0, 1, 2, 3, 4]);
  const pictureType = 'image/png';
  const updateResult = await updateUserProfilePicture(testUser.username, pictureData, pictureType);
  
  // Verify the update operation succeeded
  assert.ok(updateResult);

  // Retrieve the user by username to verify the profile picture was stored
  const updatedUser = await getUserByUsername(testUser.username);
  assert.ok(updatedUser);
  assert.strictEqual(updatedUser.profile_picture_type, pictureType);
  assert.deepStrictEqual(updatedUser.profile_picture, pictureData);
});

test('onboarding CRUD helpers work', async () => {
  const onboarding = await upsertUserOnboarding({
    username: testUser.username,
    email: 'testuser@polygon.gmbh',
    passwordHash: testUser.passwordHash,
    relays: testUser.relays,
    emailVerificationToken: 'tokentest',
    emailVerificationPinHash: '$2b$10$abcdefghijklmnopqrstuv',
    emailVerificationExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  assert.ok(onboarding);
  assert.strictEqual(onboarding.username, testUser.username);

  const fetched = await getUserOnboardingByUsername(testUser.username);
  assert.ok(fetched);
  assert.strictEqual(fetched.email, 'testuser@polygon.gmbh');

  await incrementUserOnboardingPinAttempt(testUser.username);
  const afterPinAttempt = await getUserOnboardingByUsername(testUser.username);
  assert.strictEqual(afterPinAttempt.pin_attempt_count, 1);

  const verified = await markUserOnboardingEmailVerified(testUser.username);
  assert.ok(verified.email_verified_at);

  await deleteUserOnboarding(testUser.username);
  const deleted = await getUserOnboardingByUsername(testUser.username);
  assert.strictEqual(deleted, undefined);
});
});
