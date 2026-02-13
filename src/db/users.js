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
 * @returns {Promise<Object>} Created user object
 */
export async function createUser({ username, publicKey, encryptedPrivateKey, passwordHash, relays = [] }) {
  const result = await query(
    `INSERT INTO users (username, public_key, encrypted_private_key, password_hash, relays)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, public_key, created_at`,
    [username, publicKey, encryptedPrivateKey, passwordHash, JSON.stringify(relays)]
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
 * Retrieve user for NIP-05 verification
 * Returns only username and public key (no sensitive data)
 * @param {string} username - Username to look up
 * @returns {Promise<Object|undefined>} Object with username and public_key
 */
export async function getUserForNip05(username) {
  const result = await query(
    'SELECT username, public_key FROM users WHERE username = $1',
    [username]
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
