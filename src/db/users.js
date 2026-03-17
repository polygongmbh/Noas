/**
 * User Database Operations
 * 
 * All database operations related to users table.
 * Handles CRUD operations for user accounts.
 */

import { query } from './pool.js';

/**
 * Create a new user in the database
 * @param {Object} userData - User data object
 * @param {string} userData.username - Unique username (3-32 chars, lowercase alphanumeric)
 * @param {string} userData.publicKey - Nostr public key (64-char hex)
 * @param {string} userData.encryptedPrivateKey - NIP-49 encrypted private key
 * @param {string} userData.passwordHash - Bcrypt hashed password
 * @param {Array} userData.relays - Optional array of relay URLs
 * @param {string|null} userData.email - Optional email address
 * @param {Date|null} userData.emailVerifiedAt - Optional verification timestamp
 * @param {string|null} userData.emailVerificationToken - Optional email verification token
 * @param {Date|null} userData.emailVerificationExpiresAt - Optional email verification expiry
 * @returns {Promise<Object>} Created user object
 */
export async function createUser({
  username,
  publicKey,
  encryptedPrivateKey,
  passwordHash,
  relays = [],
  email = null,
  emailVerifiedAt = null,
  emailVerificationToken = null,
  emailVerificationExpiresAt = null,
}) {
  const result = await query(
    `INSERT INTO users (
      username,
      public_key,
      encrypted_private_key,
      password_hash,
      relays,
      email,
      email_verified_at,
      email_verification_token,
      email_verification_expires_at
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, username, public_key, email, email_verified_at, created_at`,
    [
      username,
      publicKey,
      encryptedPrivateKey,
      passwordHash,
      JSON.stringify(relays),
      email,
      emailVerifiedAt,
      emailVerificationToken,
      emailVerificationExpiresAt,
    ]
  );
  return result.rows[0];
}

/**
 * Retrieve a user by username
 * Returns all user fields including sensitive data (for authentication)
 * @param {string} username - Username to look up
 * @returns {Promise<Object|undefined>} User object or undefined if not found
 */
export async function getUserByUsername(username) {
  const result = await query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0];
}

/**
 * Retrieve a user by email.
 * @param {string} email
 * @returns {Promise<Object|undefined>}
 */
export async function getUserByEmail(email) {
  const result = await query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0];
}

/**
 * Retrieve user for NIP-05 verification
 * Returns only NIP-05-safe public fields (no password/key material)
 * @param {string} username - Username to look up
 * @returns {Promise<Object|undefined>} Object with username/public_key/verification state
 */
export async function getUserForNip05(username) {
  const result = await query(
    'SELECT username, public_key, email_verified_at FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0];
}

/**
 * Retrieve a user's profile picture by public key
 * Returns binary picture data and content type
 * @param {string} publicKey - Public key to look up
 * @returns {Promise<Object|undefined>} Object with profile_picture and profile_picture_type
 */
export async function getUserProfilePictureByPublicKey(publicKey) {
  const result = await query(
    'SELECT profile_picture, profile_picture_type FROM users WHERE public_key = $1',
    [publicKey]
  );
  return result.rows[0];
}

/**
 * Update user profile picture
 * Stores binary picture data and content type
 * @param {string} username - Username of user to update
 * @param {Buffer} pictureData - Raw image bytes
 * @param {string} pictureType - MIME type of image
 * @returns {Promise<Object>} Updated user object
 */
export async function updateUserProfilePicture(username, pictureData, pictureType) {
  const result = await query(
    `UPDATE users
     SET profile_picture = $1,
         profile_picture_type = $2,
         profile_picture_updated_at = CURRENT_TIMESTAMP
     WHERE username = $3
     RETURNING id, username, public_key`,
    [pictureData, pictureType, username]
  );
  return result.rows[0];
}

/**
 * Update user fields
 * Can update password hash, encrypted private key, or relays
 * @param {string} username - Username of user to update
 * @param {Object} updates - Fields to update
 * @param {string} updates.passwordHash - New password hash
 * @param {string} updates.encryptedPrivateKey - New encrypted private key
 * @param {Array} updates.relays - New relay list
 * @returns {Promise<Object>} Updated user object
 */
export async function updateUser(username, updates) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  if (updates.passwordHash) {
    fields.push(`password_hash = $${paramCount++}`);
    values.push(updates.passwordHash);
  }
  if (updates.encryptedPrivateKey) {
    fields.push(`encrypted_private_key = $${paramCount++}`);
    values.push(updates.encryptedPrivateKey);
  }
  if (updates.relays) {
    fields.push(`relays = $${paramCount++}`);
    values.push(JSON.stringify(updates.relays));
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(username);
  
  const result = await query(
    `UPDATE users SET ${fields.join(', ')} WHERE username = $${paramCount} RETURNING id, username, public_key`,
    values
  );
  
  return result.rows[0];
}

/**
 * Delete a user account by username
 * @param {string} username - Username of user to delete
 * @returns {Promise<Object|undefined>} Deleted user summary or undefined if not found
 */
export async function deleteUser(username) {
  const result = await query(
    'DELETE FROM users WHERE username = $1 RETURNING id, username, public_key',
    [username]
  );
  return result.rows[0];
}

/**
 * Mark a user email as verified if the token is valid and not expired.
 * @param {string} username - Username of user to verify
 * @param {string} token - Email verification token
 * @returns {Promise<Object|undefined>} Updated user summary or undefined if not verified
 */
export async function verifyUserEmail(username, token) {
  const result = await query(
    `UPDATE users
     SET email_verified_at = CURRENT_TIMESTAMP,
         email_verification_token = NULL,
         email_verification_expires_at = NULL
     WHERE username = $1
       AND email_verification_token = $2
       AND (email_verification_expires_at IS NULL OR email_verification_expires_at > CURRENT_TIMESTAMP)
     RETURNING id, username, public_key, email, email_verified_at`,
    [username, token]
  );
  return result.rows[0];
}

/**
 * Create or replace a pending onboarding record.
 * Reuses the same username+email pair to allow retries without storing key material.
 * @param {Object} onboardingData
 * @param {string} onboardingData.username
 * @param {string} onboardingData.email
 * @param {string} onboardingData.passwordHash
 * @param {Array} onboardingData.relays
 * @param {string} onboardingData.emailVerificationToken
 * @param {string} onboardingData.emailVerificationPinHash
 * @param {Date} onboardingData.emailVerificationExpiresAt
 * @returns {Promise<Object>}
 */
export async function upsertUserOnboarding({
  username,
  email,
  passwordHash,
  relays = [],
  emailVerificationToken,
  emailVerificationPinHash,
  emailVerificationExpiresAt,
  verificationOrigin = null,
  publicKey = null,
  encryptedPrivateKey = null,
}) {
  const result = await query(
    `INSERT INTO user_onboarding (
      username,
      email,
      password_hash,
      relays,
      email_verification_token,
      email_verification_pin_hash,
      email_verification_expires_at,
      email_verified_at,
      pin_attempt_count,
      verification_origin,
      public_key,
      encrypted_private_key,
      last_email_sent_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 0, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (username) DO UPDATE
    SET email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        relays = EXCLUDED.relays,
        email_verification_token = EXCLUDED.email_verification_token,
        email_verification_pin_hash = EXCLUDED.email_verification_pin_hash,
        email_verification_expires_at = EXCLUDED.email_verification_expires_at,
        email_verified_at = NULL,
        pin_attempt_count = 0,
        verification_origin = EXCLUDED.verification_origin,
        public_key = EXCLUDED.public_key,
        encrypted_private_key = EXCLUDED.encrypted_private_key,
        last_email_sent_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id, username, email, relays, email_verified_at, email_verification_expires_at, verification_origin, public_key, encrypted_private_key, last_email_sent_at, created_at, updated_at`,
    [
      username,
      email,
      passwordHash,
      JSON.stringify(relays),
      emailVerificationToken,
      emailVerificationPinHash,
      emailVerificationExpiresAt,
      verificationOrigin,
      publicKey,
      encryptedPrivateKey,
    ]
  );
  return result.rows[0];
}

/**
 * Get a pending onboarding record by username.
 * @param {string} username
 * @returns {Promise<Object|undefined>}
 */
export async function getUserOnboardingByUsername(username) {
  const result = await query(
    'SELECT * FROM user_onboarding WHERE username = $1',
    [username]
  );
  return result.rows[0];
}

/**
 * Get a pending onboarding record by email.
 * @param {string} email
 * @returns {Promise<Object|undefined>}
 */
export async function getUserOnboardingByEmail(email) {
  const result = await query(
    'SELECT * FROM user_onboarding WHERE email = $1',
    [email]
  );
  return result.rows[0];
}

/**
 * Get a pending onboarding record by verification token.
 * @param {string} token
 * @returns {Promise<Object|undefined>}
 */
export async function getUserOnboardingByVerificationToken(token) {
  const result = await query(
    'SELECT * FROM user_onboarding WHERE email_verification_token = $1',
    [token]
  );
  return result.rows[0];
}

/**
 * Mark onboarding email as verified and clear verification secrets.
 * @param {string} username
 * @returns {Promise<Object|undefined>}
 */
export async function markUserOnboardingEmailVerified(username) {
  const result = await query(
    `UPDATE user_onboarding
     SET email_verified_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE username = $1
     RETURNING id, username, email, relays, email_verified_at, email_verification_expires_at`,
    [username]
  );
  return result.rows[0];
}

/**
 * Increment PIN attempt count for an onboarding record.
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function incrementUserOnboardingPinAttempt(username) {
  await query(
    `UPDATE user_onboarding
     SET pin_attempt_count = pin_attempt_count + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE username = $1`,
    [username]
  );
}

/**
 * Delete pending onboarding by username.
 * @param {string} username
 * @returns {Promise<void>}
 */
export async function deleteUserOnboarding(username) {
  await query('DELETE FROM user_onboarding WHERE username = $1', [username]);
}

/**
 * Delete pending onboarding by verification token.
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function deleteUserOnboardingByToken(token) {
  await query('DELETE FROM user_onboarding WHERE email_verification_token = $1', [token]);
}

/**
 * Delete expired onboarding records and return affected row count.
 * @returns {Promise<number>}
 */
export async function deleteExpiredUserOnboarding() {
  const result = await query(
    `DELETE FROM user_onboarding
     WHERE email_verification_expires_at < CURRENT_TIMESTAMP`
  );
  return result.rowCount || 0;
}

/**
 * Record a verification token as used.
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function recordUsedVerificationToken(token) {
  await query(
    `INSERT INTO used_verification_tokens (token)
     VALUES ($1)
     ON CONFLICT (token) DO NOTHING`,
    [token]
  );
}

/**
 * Check whether a verification token was already used.
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export async function isVerificationTokenUsed(token) {
  const result = await query(
    'SELECT token FROM used_verification_tokens WHERE token = $1',
    [token]
  );
  return result.rows.length > 0;
}
