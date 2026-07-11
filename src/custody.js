/**
 * Key Custody Module
 *
 * Resolves the NIP-49 decryption secret for an account and unlocks stored
 * key material for server-side signing. Accounts come in two custody modes:
 * - 'password' (legacy): the NIP-49 ciphertext is encrypted with the user's
 *   signup password, kept in `raw_password` when available.
 * - 'master_key': the account was provisioned by a trusted service and its
 *   NIP-49 ciphertext is encrypted with the shared CUSTODY_MASTER_KEY;
 *   `raw_password` stays NULL.
 */

import { getPublicKey } from 'nostr-tools';
import { decrypt } from 'nostr-tools/nip49';
import { config } from './config.js';

export const CUSTODY_MODES = {
  PASSWORD: 'password',
  MASTER_KEY: 'master_key',
};

export const UNLOCK_ERRORS = {
  UNAVAILABLE: 'unavailable',
  UNLOCK_FAILED: 'unlock_failed',
  PUBKEY_MISMATCH: 'pubkey_mismatch',
};

/**
 * Whether an account's key is held under master-key custody.
 * @param {Object} user - nostr_users row
 * @returns {boolean}
 */
export function isMasterKeyCustody(user) {
  return user?.custody === CUSTODY_MODES.MASTER_KEY;
}

/**
 * Resolve the NIP-49 password that unlocks the account's encrypted key.
 * @param {Object} user - nostr_users row
 * @returns {string|null} Decryption secret or null when unavailable
 */
export function resolveSigningSecret(user) {
  if (isMasterKeyCustody(user)) {
    return config.custodyMasterKey || null;
  }
  return user?.raw_password || null;
}

/**
 * Unlock the stored NIP-49 key of an account for server-side signing.
 * @param {Object} user - nostr_users row
 * @returns {{secretKey?: Uint8Array, publicKey?: string, error?: string}}
 *   On failure, error is one of UNLOCK_ERRORS.
 */
export function unlockNostrUserSecretKey(user) {
  const signingSecret = resolveSigningSecret(user);
  if (!user?.public_key || !user.private_key_encrypted || !signingSecret) {
    return { error: UNLOCK_ERRORS.UNAVAILABLE };
  }

  let secretKey;
  try {
    secretKey = decrypt(user.private_key_encrypted, signingSecret);
  } catch {
    return { error: UNLOCK_ERRORS.UNLOCK_FAILED };
  }

  const publicKey = getPublicKey(secretKey).toLowerCase();
  if (publicKey !== String(user.public_key).trim().toLowerCase()) {
    return { error: UNLOCK_ERRORS.PUBKEY_MISMATCH };
  }

  return { secretKey, publicKey };
}
