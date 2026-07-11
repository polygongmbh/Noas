/**
 * Magic Link Token Database Operations
 *
 * Single-use login/confirm tokens issued to trusted services. Noas only
 * stores and verifies them; delivering the link by email is the calling
 * service's responsibility.
 */

import { query } from './pool.js';

/**
 * Create a magic link token.
 * @param {Object} params
 * @param {string} params.token - Opaque token value
 * @param {number} params.userId - Account the token belongs to
 * @param {string} params.tenantDomain - Tenant root domain
 * @param {string} params.purpose - 'login' or 'confirm'
 * @param {Date} params.expiresAt - Expiry timestamp
 * @returns {Promise<Object>} Created token row
 */
export async function createMagicLinkToken({ token, userId, tenantDomain, purpose, expiresAt }) {
  const result = await query(
    `INSERT INTO magic_link_tokens (token, user_id, tenant_domain, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [token, userId, tenantDomain, purpose, expiresAt]
  );
  return result.rows[0];
}

/**
 * Retrieve a magic link token by value.
 * @param {string} token
 * @returns {Promise<Object|undefined>}
 */
export async function getMagicLinkToken(token) {
  const result = await query(
    'SELECT * FROM magic_link_tokens WHERE token = $1',
    [token]
  );
  return result.rows[0];
}

/**
 * Atomically consume a magic link token (single use).
 * Only succeeds for tokens that are unused and unexpired.
 * @param {string} token
 * @returns {Promise<Object|undefined>} Consumed token row or undefined
 */
export async function consumeMagicLinkToken(token) {
  const result = await query(
    `UPDATE magic_link_tokens
     SET used_at = NOW()
     WHERE token = $1
       AND used_at IS NULL
       AND expires_at > NOW()
     RETURNING *`,
    [token]
  );
  return result.rows[0];
}

/**
 * Delete expired magic link tokens and return number of deleted rows.
 * @returns {Promise<number>}
 */
export async function deleteExpiredMagicLinkTokens() {
  const result = await query(
    'DELETE FROM magic_link_tokens WHERE expires_at <= NOW()'
  );
  return result.rowCount || 0;
}
