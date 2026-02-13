/**
 * Authentication & Validation Module
 * 
 * Handles password hashing/verification and input validation.
 * All validation functions return {valid: boolean, error?: string}
 */

import bcrypt from 'bcrypt';

// Number of salt rounds for bcrypt hashing
const SALT_ROUNDS = 10;

/**
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Bcrypt hash
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a bcrypt hash
 * @param {string} password - Plain text password to verify
 * @param {string} hash - Bcrypt hash to compare against
 * @returns {Promise<boolean>} True if password matches
 */
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Validate username format
 * Must be 3-32 characters, lowercase letters, numbers, and underscores only
 * @param {string} username - Username to validate
 * @returns {Object} {valid: boolean, error?: string}
 */
export function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }
  if (username.length < 3 || username.length > 32) {
    return { valid: false, error: 'Username must be 3-32 characters' };
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    return { valid: false, error: 'Username must contain only lowercase letters, numbers, and underscores' };
  }
  return { valid: true };
}

/**
 * Validate Nostr public key format
 * Must be exactly 64 characters of lowercase hex
 * @param {string} pubkey - Public key to validate
 * @returns {Object} {valid: boolean, error?: string}
 */
export function validatePublicKey(pubkey) {
  if (!pubkey || typeof pubkey !== 'string') {
    return { valid: false, error: 'Public key is required' };
  }
  if (!/^[a-f0-9]{64}$/.test(pubkey)) {
    return { valid: false, error: 'Public key must be a 64-character hex string' };
  }
  return { valid: true };
}

/**
 * Validate NIP-49 encrypted private key format
 * Must start with "ncryptsec" prefix
 * @param {string} encryptedKey - Encrypted key to validate
 * @returns {Object} {valid: boolean, error?: string}
 */
export function validateEncryptedPrivateKey(encryptedKey) {
  if (!encryptedKey || typeof encryptedKey !== 'string') {
    return { valid: false, error: 'Encrypted private key is required' };
  }
  // NIP-49 format starts with "ncryptsec"
  if (!encryptedKey.startsWith('ncryptsec')) {
    return { valid: false, error: 'Invalid encrypted key format (must be NIP-49 ncryptsec)' };
  }
  return { valid: true };
}
